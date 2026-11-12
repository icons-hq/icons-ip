\set ON_ERROR_STOP on
-- 회수 확인의 실제 입고일과 단계 일괄 처리가 읽는 클레임 사실(1027T-033·SHEET-049·SHEET-052).
-- 회수 생략의 진실원은 결정 표다(private.claim_collection_waived). 결정만 하고 아직 재출고하지 않은 배송 건도 회수
-- 생략으로 보고, 그 배송 건이 돌아오지 않았으면 회수 완료 알림은 "반송한 굿즈가 모두 입고"가 아니라 "반송이 필요한 굿즈가 모두 입고"다.
-- 출고지별 회수는 배송 건마다 입고일을 받고(기본 오늘, 미래·주문일 이전 거절), 모두 회수되면 가장 늦은 입고일이
-- 클레임의 회수 완료일이 된다. 환급 기한은 그 날부터 센다. 일괄 처리 사실(admin_order_claim_bulk_context)은
-- 무통장·가상계좌·코페이·결제 없음·회수 미완료를 환불 일괄에서 빼는 사유와 서버가 계산한 환불 금액을 돌려준다.
-- 회수 생략 결정이 효력을 잃어 입고완료가 수거중으로 돌아가면 회수 완료일도 비고, 실제 입고로 다시 끝나면 다시 센다.
-- 합성 데이터만 쓰고 롤백한다. 결제사 API는 부르지 않는다.
begin;
load 'safeupdate';
create function pg_temp.ro_id(kind text,n integer) returns uuid language sql immutable as $$select md5('claim-received-on:'||kind||':'||n)::uuid$$;
create function pg_temp.ro_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'received-on assertion: %',label;end if;end$$;
create function pg_temp.ro_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected received-on rejection: %',expected;end$$;
create function pg_temp.ro_today() returns date language sql stable as $$select (clock_timestamp() at time zone 'Asia/Seoul')::date$$;

-- 새 진입점과 도우미의 권한(운영자 세션만, 익명·service_role 직접 호출 없음).
select pg_temp.ro_assert(
 has_function_privilege('authenticated','public.admin_record_order_claim_origin_collection(uuid,uuid,text,date)','execute')
 and not has_function_privilege('anon','public.admin_record_order_claim_origin_collection(uuid,uuid,text,date)','execute')
 and not has_function_privilege('service_role','public.admin_record_order_claim_origin_collection(uuid,uuid,text,date)','execute')
 and has_function_privilege('authenticated','public.admin_record_order_claim_collection(uuid,text,date,text)','execute')
 and not has_function_privilege('anon','public.admin_record_order_claim_collection(uuid,text,date,text)','execute')
 and not has_function_privilege('service_role','public.admin_record_order_claim_collection(uuid,text,date,text)','execute')
 and to_regprocedure('public.admin_record_order_claim_collection(uuid,text,date)') is null
 and has_function_privilege('authenticated','public.admin_order_claim_bulk_context(uuid[])','execute')
 and not has_function_privilege('anon','public.admin_order_claim_bulk_context(uuid[])','execute')
 and not has_function_privilege('service_role','public.admin_order_claim_bulk_context(uuid[])','execute')
 and has_function_privilege('authenticated','public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text)','execute')
 and not has_function_privilege('anon','public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text)','execute')
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in('claim_collection_received_on','order_claim_bulk_context_row','claim_collection_records','reopen_ineffective_collection_waivers')
  and(has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')))
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_order_claim_bulk_context(uuid[])' and capability='sales.manage' and guard_kind='read')
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_record_order_claim_origin_collection(uuid,uuid,text,date)' and guard_kind='write')
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_record_order_claim_collection(uuid,text,date,text)' and guard_kind='write'),
 'entry points are operator-only and classified');

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.ro_id('user',n),'authenticated','authenticated','claim-received-on-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set nickname='TEST 입고일 '||right(id::text,6),
 role=case when id=pg_temp.ro_id('user',2) then 'user'::public.user_role else 'admin'::public.user_role end
 where id in(select pg_temp.ro_id('user',n) from generate_series(1,3)n);
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.ro_id('user',3),'owner' where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.ro_id('user',1),'primary');
update private.operator_access_state set configured=true where id;

insert into public.ips(id,title,vertical_key) values('ro-ip','TEST 입고일','character');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values
 (pg_temp.ro_id('origin',1),'ro-gimpo','TEST 김포','hanjin',0,'TEST 김포 반송지',true),
 (pg_temp.ro_id('origin',2),'ro-namyangju','TEST 남양주','hanjin',0,'TEST 남양주 반송지',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
 ('ro-good-1','ro-ip','TEST 김포 굿즈','문구',1000,'ok',10,pg_temp.ro_id('origin',1)),
 ('ro-good-2','ro-ip','TEST 남양주 굿즈','문구',2000,'ok',10,pg_temp.ro_id('origin',2));
create function pg_temp.ro_default(good text) returns uuid language sql stable as $$select id from public.goods_variants where good_id=good and is_default$$;
create function pg_temp.ro_stock(good text) returns integer language sql stable as $$select stock_qty from public.goods_variants where good_id=good and is_default$$;

-- 주문 1: 김포·남양주 반품(토스). 주문 2: 레거시 회수 반품(무통장). 주문 3: 김포·남양주 하자 교환(남양주 회수 생략 재출고).
-- 주문 4~8: 환불 일괄 사실(코페이·가상계좌·결제 없음·정상 토스·승인 전). 주문 9: 회수 생략 결정이 무효가 되는 하자 교환.
-- 주문 10~12: 입고 뒤 결정하는 하자 교환(정방향 완료·사유 되돌림, 보류 대칭, 모두 회수 생략). 모든 주문은 닷새 전에 만들었다.
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at,created_at)
 select pg_temp.ro_id('order',n),pg_temp.ro_id('user',2),'delivered',5000,0,
  jsonb_build_object('recipientName','합성 고객','phone','010-0000-0000','postalCode','12345','address1','합성시 입고일로 1','address2','101호'),
  now()-interval '4 days',now()-interval '3 days',now()-interval '5 days' from generate_series(1,12)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.ro_id('item',item),pg_temp.ro_id('order',purchase),good,pg_temp.ro_default(good),1,1000,'TEST 굿즈','문구','ro-ip'
 from (values(1,1,'ro-good-1'),(2,1,'ro-good-2'),(3,2,'ro-good-1'),(5,3,'ro-good-1'),(6,3,'ro-good-2'),
  (7,4,'ro-good-1'),(8,5,'ro-good-1'),(9,6,'ro-good-1'),(10,7,'ro-good-1'),(11,8,'ro-good-1'),(12,9,'ro-good-1'),(13,9,'ro-good-2'),
  (14,10,'ro-good-1'),(15,10,'ro-good-2'),(16,11,'ro-good-1'),(17,11,'ro-good-2'),(18,12,'ro-good-1'),(19,12,'ro-good-2')) spec(item,purchase,good);
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at) values
 (pg_temp.ro_id('shipment',1),pg_temp.ro_id('order',1),pg_temp.ro_id('origin',1),'TEST 김포',0,'{}','delivered','hanjin','ROSALE000001',now()-interval '4 days',now()-interval '3 days'),
 (pg_temp.ro_id('shipment',2),pg_temp.ro_id('order',1),pg_temp.ro_id('origin',2),'TEST 남양주',0,'{}','delivered','hanjin','ROSALE000002',now()-interval '4 days',now()-interval '3 days'),
 (pg_temp.ro_id('shipment',3),pg_temp.ro_id('order',2),pg_temp.ro_id('origin',1),'TEST 김포',0,'{}','delivered','hanjin','ROSALE000003',now()-interval '4 days',now()-interval '3 days'),
 (pg_temp.ro_id('shipment',5),pg_temp.ro_id('order',3),pg_temp.ro_id('origin',1),'TEST 김포',0,'{}','delivered','hanjin','ROSALE000005',now()-interval '4 days',now()-interval '3 days'),
 (pg_temp.ro_id('shipment',6),pg_temp.ro_id('order',3),pg_temp.ro_id('origin',2),'TEST 남양주',0,'{}','delivered','hanjin','ROSALE000006',now()-interval '4 days',now()-interval '3 days'),
 (pg_temp.ro_id('shipment',7),pg_temp.ro_id('order',9),pg_temp.ro_id('origin',1),'TEST 김포',0,'{}','delivered','hanjin','ROSALE000007',now()-interval '4 days',now()-interval '3 days'),
 (pg_temp.ro_id('shipment',8),pg_temp.ro_id('order',9),pg_temp.ro_id('origin',2),'TEST 남양주',0,'{}','delivered','hanjin','ROSALE000008',now()-interval '4 days',now()-interval '3 days');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at)
 select pg_temp.ro_id('shipment',2*n-11+k),pg_temp.ro_id('order',n),pg_temp.ro_id('origin',k),case k when 1 then 'TEST 김포' else 'TEST 남양주' end,0,'{}','delivered','hanjin',
  'ROSALE'||lpad((2*n-11+k)::text,6,'0'),now()-interval '4 days',now()-interval '3 days' from generate_series(10,12)n cross join generate_series(1,2)k;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values
 (pg_temp.ro_id('order',1),pg_temp.ro_id('shipment',1),pg_temp.ro_id('item',1),1),
 (pg_temp.ro_id('order',1),pg_temp.ro_id('shipment',2),pg_temp.ro_id('item',2),1),
 (pg_temp.ro_id('order',2),pg_temp.ro_id('shipment',3),pg_temp.ro_id('item',3),1),
 (pg_temp.ro_id('order',3),pg_temp.ro_id('shipment',5),pg_temp.ro_id('item',5),1),
 (pg_temp.ro_id('order',3),pg_temp.ro_id('shipment',6),pg_temp.ro_id('item',6),1),
 (pg_temp.ro_id('order',9),pg_temp.ro_id('shipment',7),pg_temp.ro_id('item',12),1),
 (pg_temp.ro_id('order',9),pg_temp.ro_id('shipment',8),pg_temp.ro_id('item',13),1);
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
 select pg_temp.ro_id('order',n),pg_temp.ro_id('shipment',2*n-11+k),pg_temp.ro_id('item',2*n-7+k),1 from generate_series(10,12)n cross join generate_series(1,2)k;
insert into public.payments(id,user_id,purpose,ref_id,amount,status,idempotency_key,provider) values
 (pg_temp.ro_id('payment',1),pg_temp.ro_id('user',2),'order',pg_temp.ro_id('order',1),5000,'paid','ro-pay-1','toss'),
 (pg_temp.ro_id('payment',2),pg_temp.ro_id('user',2),'order',pg_temp.ro_id('order',2),5000,'paid','ro-pay-2','bank_transfer'),
 (pg_temp.ro_id('payment',3),pg_temp.ro_id('user',2),'order',pg_temp.ro_id('order',3),5000,'paid','ro-pay-3','toss'),
 (pg_temp.ro_id('payment',4),pg_temp.ro_id('user',2),'order',pg_temp.ro_id('order',4),5000,'paid','ro-pay-4','korpay'),
 (pg_temp.ro_id('payment',5),pg_temp.ro_id('user',2),'order',pg_temp.ro_id('order',5),5000,'paid','ro-pay-5','toss'),
 (pg_temp.ro_id('payment',7),pg_temp.ro_id('user',2),'order',pg_temp.ro_id('order',7),7000,'paid','ro-pay-7','nicepay'),
 (pg_temp.ro_id('payment',8),pg_temp.ro_id('user',2),'order',pg_temp.ro_id('order',8),5000,'paid','ro-pay-8','toss'),
 (pg_temp.ro_id('payment',9),pg_temp.ro_id('user',2),'order',pg_temp.ro_id('order',9),5000,'paid','ro-pay-9','toss');
insert into public.payments(id,user_id,purpose,ref_id,amount,status,idempotency_key,provider)
 select pg_temp.ro_id('payment',n),pg_temp.ro_id('user',2),'order',pg_temp.ro_id('order',n),5000,'paid','ro-pay-'||n,'toss' from generate_series(10,12)n;
-- 주문 5는 토스로 승인됐지만 결제사 증빙이 가상계좌다(입금 뒤 환불계좌가 필요한 결제).
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 values(pg_temp.ro_id('attempt',5),'toss',pg_temp.ro_id('user',2),'order',pg_temp.ro_id('order',5),5000,'approved','ro-attempt-5','ro-provider-order-5','ro-product',pg_temp.ro_id('payment',5),now()+interval '1 day');
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,result_code,payment_method)
 values(pg_temp.ro_id('attempt',5),'reconcile','DONE_virtual_account','가상계좌');

insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type) values
 (pg_temp.ro_id('claim',1),pg_temp.ro_id('order',1),pg_temp.ro_id('user',2),'TEST 김포·남양주 반품','return','requested','change_of_mind'),
 (pg_temp.ro_id('claim',3),pg_temp.ro_id('order',3),pg_temp.ro_id('user',2),'TEST 김포·남양주 하자 교환','exchange','requested','defect'),
 (pg_temp.ro_id('claim',8),pg_temp.ro_id('order',8),pg_temp.ro_id('user',2),'TEST 승인 전 반품','return','requested','change_of_mind'),
 (pg_temp.ro_id('claim',9),pg_temp.ro_id('order',9),pg_temp.ro_id('user',2),'TEST 결정이 무효가 되는 하자 교환','exchange','requested','defect');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type)
 select pg_temp.ro_id('claim',n),pg_temp.ro_id('order',n),pg_temp.ro_id('user',2),'TEST 입고 뒤 결정하는 하자 교환 '||n,'exchange','requested','defect' from generate_series(10,12)n;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type,collection_policy) values
 (pg_temp.ro_id('claim',2),pg_temp.ro_id('order',2),pg_temp.ro_id('user',2),'TEST 레거시 반품','return','collecting','change_of_mind','legacy');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type,collection_policy,collected_at)
 select pg_temp.ro_id('claim',n),pg_temp.ro_id('order',n),pg_temp.ro_id('user',2),'TEST 레거시 입고완료 반품 '||n,'return','collected','change_of_mind','legacy',now()-interval '1 day'
 from unnest(array[4,5,6,7])n;

select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub',pg_temp.ro_id('user',1)::text,true);
select public.admin_decide_order_claim(pg_temp.ro_id('claim',n),'approve',null) from unnest(array[1,3,9,10,11,12])n;
select pg_temp.ro_assert((select count(*)=2 from public.order_claim_collections where claim_id=pg_temp.ro_id('claim',1) and received_on is null)
 and (select stage='collecting' and collection_received_on is null from public.order_cancellation_requests where id=pg_temp.ro_id('claim',1)),
 'approval opens two origin collections without a received date');

-- 입고일 범위: 미래와 주문일보다 이른 날은 받지 않는다. 그 사이 입고 근거는 저장되지 않는다.
select pg_temp.ro_error(format('select public.admin_record_order_claim_origin_collection(%L,%L,''TEST 김포 입고'',%L::date)',
 pg_temp.ro_id('claim',1),pg_temp.ro_id('shipment',1),pg_temp.ro_today()+1),'invalid_collection_received_on');
select pg_temp.ro_error(format('select public.admin_record_order_claim_origin_collection(%L,%L,''TEST 김포 입고'',%L::date)',
 pg_temp.ro_id('claim',1),pg_temp.ro_id('shipment',1),pg_temp.ro_today()-6),'invalid_collection_received_on');
select pg_temp.ro_assert((select collected_at is null from public.order_claim_collections where claim_id=pg_temp.ro_id('claim',1) and shipment_id=pg_temp.ro_id('shipment',1)),
 'rejected dates leave the collection open');

-- 김포: 이틀 전 입고. 확인 시각(collected_at)은 지금이고 입고일은 따로 남는다. 클레임은 남양주를 기다린다.
select public.admin_record_order_claim_origin_collection(pg_temp.ro_id('claim',1),pg_temp.ro_id('shipment',1),'TEST 김포 입고 1개 대조',pg_temp.ro_today()-2) as gimpo \gset
select pg_temp.ro_assert(:'gimpo'='collecting'
 and (select received_on=pg_temp.ro_today()-2 and collected_at>=now() and collected_by=pg_temp.ro_id('user',1)
  from public.order_claim_collections where claim_id=pg_temp.ro_id('claim',1) and shipment_id=pg_temp.ro_id('shipment',1))
 and (select stage='collecting' and collected_at is null and collection_received_on is null from public.order_cancellation_requests where id=pg_temp.ro_id('claim',1))
 and (select (diff->>'receivedOn')::date=pg_temp.ro_today()-2 and diff->>'evidence'='TEST 김포 입고 1개 대조' and diff->>'collectionWaived'='false'
  from public.audit_log where action='admin.order.claim_origin_collected' and diff->>'shipmentId'=pg_temp.ro_id('shipment',1)::text),
 'first origin keeps its received date and the claim keeps collecting');
-- 재전송: 같은 근거·같은 입고일, 또는 입고일 없는 옛 경로는 멱등하다. 다른 입고일은 충돌이다.
select pg_temp.ro_assert(public.admin_record_order_claim_origin_collection(pg_temp.ro_id('claim',1),pg_temp.ro_id('shipment',1),'TEST 김포 입고 1개 대조',pg_temp.ro_today()-2)='collecting'
 and public.admin_record_order_claim_origin_collection(pg_temp.ro_id('claim',1),pg_temp.ro_id('shipment',1),'TEST 김포 입고 1개 대조')='collecting'
 and (select count(*)=1 from public.audit_log where action='admin.order.claim_origin_collected' and diff->>'shipmentId'=pg_temp.ro_id('shipment',1)::text),
 'exact replays do not record twice');
select pg_temp.ro_error(format('select public.admin_record_order_claim_origin_collection(%L,%L,''TEST 김포 입고 1개 대조'',%L::date)',
 pg_temp.ro_id('claim',1),pg_temp.ro_id('shipment',1),pg_temp.ro_today()-1),'claim_collection_conflict');

-- 일괄 사실: 회수 미완료 반품은 환불 일괄에서 빠진다.
select public.admin_order_claim_bulk_context(array[pg_temp.ro_id('claim',1)])->0 as partial \gset
select pg_temp.ro_assert((:'partial'::jsonb)->>'refundBlocker'='claim_collections_incomplete'
 and ((:'partial'::jsonb)->>'refundAmount')::bigint=5000 and (:'partial'::jsonb)->>'paymentProvider'='toss'
 and jsonb_array_length((:'partial'::jsonb)->'collections')=2
 and (select count(*)=1 from jsonb_array_elements((:'partial'::jsonb)->'collections') x where x->>'collectedAt' is null and not (x->>'waived')::boolean and (x->>'returnAddressReady')::boolean),
 'bulk context lists the pending origin and blocks the refund');

-- 남양주: 어제 입고 → 모든 출고지 회수. 클레임 회수 완료일은 가장 늦은 입고일(어제)이다.
select public.admin_record_order_claim_origin_collection(pg_temp.ro_id('claim',1),pg_temp.ro_id('shipment',2),'TEST 남양주 입고 1개 대조',pg_temp.ro_today()-1) as namyangju \gset
select pg_temp.ro_assert(:'namyangju'='collected'
 and (select stage='collected' and collected_at is not null and collection_received_on=pg_temp.ro_today()-1 from public.order_cancellation_requests where id=pg_temp.ro_id('claim',1))
 and public.admin_order_claim_detail(pg_temp.ro_id('claim',1))#>>'{claim,collectionReceivedOn}'=(pg_temp.ro_today()-1)::text
 and (select count(*)=2 from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.ro_id('claim',1))#>'{claim,collections}') x
  where x->>'receivedOn' is not null and x->>'collectionWaived'='false')
 and (select collection_received_on=pg_temp.ro_today()-1 from public.admin_search_order_claims_console('return',null,null,null,null,'TEST',100,0,'all','requested','newest') where id=pg_temp.ro_id('claim',1)),
 'last origin completes the claim from the latest received date');

-- 환불 일괄 사실: 토스·나이스페이만 결제사 취소로 처리하고 나머지는 사유와 함께 뺀다.
select public.admin_order_claim_bulk_context(array[pg_temp.ro_id('claim',1),pg_temp.ro_id('claim',4),pg_temp.ro_id('claim',5),pg_temp.ro_id('claim',6),
 pg_temp.ro_id('claim',7),pg_temp.ro_id('claim',8),pg_temp.ro_id('claim',3),pg_temp.ro_id('claim',1),pg_temp.ro_id('missing',1)]) as facts \gset
select pg_temp.ro_assert(jsonb_array_length(:'facts'::jsonb)=7
 and (select array_agg(x.value->>'claimId' order by x.ordinality)=array[pg_temp.ro_id('claim',1),pg_temp.ro_id('claim',4),pg_temp.ro_id('claim',5),pg_temp.ro_id('claim',6),
  pg_temp.ro_id('claim',7),pg_temp.ro_id('claim',8),pg_temp.ro_id('claim',3)]::text[] from jsonb_array_elements(:'facts'::jsonb) with ordinality x(value,ordinality))
 and (:'facts'::jsonb)->0->'refundBlocker'='null'::jsonb and ((:'facts'::jsonb)->0->>'refundAmount')::bigint=5000
 and (:'facts'::jsonb)->1->>'refundBlocker'='korpay'
 and (:'facts'::jsonb)->2->>'refundBlocker'='virtual_account'
 and (:'facts'::jsonb)->3->>'refundBlocker'='payment_missing' and (:'facts'::jsonb)->3->'refundAmount'='null'::jsonb
 and (:'facts'::jsonb)->4->'refundBlocker'='null'::jsonb and ((:'facts'::jsonb)->4->>'refundAmount')::bigint=7000 and (:'facts'::jsonb)->4->>'paymentProvider'='nicepay'
 and (:'facts'::jsonb)->5->>'refundBlocker'='claim_not_approved'
 and (:'facts'::jsonb)->6->>'refundBlocker'='exchange_has_no_refund'
 and not ((:'facts'::jsonb)::text ~ '가상계좌'),
 'bulk refund facts: order kept, duplicates and missing ids dropped, provider exclusions');
select public.admin_order_claim_bulk_context(array[pg_temp.ro_id('claim',2)])->0->>'refundBlocker' as legacy_collecting \gset
select pg_temp.ro_assert(:'legacy_collecting'='claim_collections_incomplete','legacy claim still collecting is not refundable');

-- 레거시 회수: 입고일을 받아 클레임 회수 완료일에 남기고, 근거 열이 없어 받은 근거는 감사 기록에 남긴다.
select pg_temp.ro_error(format('select public.admin_record_order_claim_collection(%L,''collected'',%L::date,null)',pg_temp.ro_id('claim',2),pg_temp.ro_today()+1),'invalid_collection_received_on');
select pg_temp.ro_error(format('select public.admin_record_order_claim_collection(%L,''collected'',null,%L)',pg_temp.ro_id('claim',2),' 앞뒤 공백 근거 '),'invalid_collection_evidence');
select public.admin_record_order_claim_collection(pg_temp.ro_id('claim',2),'collected',pg_temp.ro_today()-3,'TEST 레거시 창고 회신 대조') as legacy \gset
select pg_temp.ro_assert(:'legacy'='collected'
 and (select stage='collected' and collection_received_on=pg_temp.ro_today()-3 and collected_at is not null from public.order_cancellation_requests where id=pg_temp.ro_id('claim',2))
 and public.admin_record_order_claim_collection(pg_temp.ro_id('claim',2),'collected')='collected'
 and (select (diff->>'receivedOn')::date=pg_temp.ro_today()-3 and diff->>'evidence'='TEST 레거시 창고 회신 대조'
  from public.audit_log where action='admin.order.claim_collected' and diff->>'claimId'=pg_temp.ro_id('claim',2)::text)
 and public.admin_order_claim_bulk_context(array[pg_temp.ro_id('claim',2)])->0->>'refundBlocker'='bank_transfer',
 'legacy collection keeps the received date; bank transfer stays out of the bulk refund');

-- 주문 1의 회수 완료 알림은 "모두 입고"다(회수 생략 배송 건 없음).
select pg_temp.ro_assert((select count(*)=1 from public.notifications where user_id=pg_temp.ro_id('user',2) and source_id=pg_temp.ro_id('claim',1)::text
  and title='반송한 굿즈가 모두 입고됐어요' and body='모든 출고지의 입고가 확인되어 후속 처리를 준비합니다.'),'plain completion says every origin arrived');

-- 하자 교환: 남양주는 회수 생략을 결정만 하고(결정 표, ADR-0041) 아직 재출고하지 않았다. 재출고 행이 없어도 회수
-- 생략으로 보고, 일괄 회수 확인 사실에서 빠지며, 김포 입고로 회수가 끝나도 "반송한 굿즈가 모두 입고"라고 알리지 않는다.
insert into private.claim_evidence_files(id,claim_id,actor_id,mime_type,size_bytes,sha256,path)
 values(pg_temp.ro_id('file',1),pg_temp.ro_id('claim',3),pg_temp.ro_id('user',1),'image/png',10,repeat('a',64),pg_temp.ro_id('claim',3)::text||'/'||pg_temp.ro_id('file',1)::text||'.png');
select public.admin_waive_order_claim_collection(pg_temp.ro_id('claim',3),pg_temp.ro_id('shipment',6),
 jsonb_build_object('reason','TEST 인쇄 불량 사진으로 회수 생략','evidenceFileIds',jsonb_build_array(pg_temp.ro_id('file',1))))->>'replayed' as waiver_replayed \gset
select public.admin_order_claim_bulk_context(array[pg_temp.ro_id('claim',3)])->0->'collections' as exchange_collections \gset
select pg_temp.ro_assert(:'waiver_replayed'='false'
 and not exists(select 1 from public.order_claim_reshipments where claim_id=pg_temp.ro_id('claim',3))
 and private.claim_collection_waived(pg_temp.ro_id('claim',3),pg_temp.ro_id('shipment',6))
 and (select count(*)=1 from jsonb_array_elements(:'exchange_collections'::jsonb) x
  where (x->>'waived')::boolean and x->>'originName'='TEST 남양주' and x->>'collectedAt' is null)
 and (select count(*)=1 from jsonb_array_elements(:'exchange_collections'::jsonb) x where not (x->>'waived')::boolean)
 and (select count(*)=1 from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.ro_id('claim',3))#>'{claim,collections}') x
  where x->>'collectionWaived'='true' and x->>'collectedAt' is null),
 'a waiver decision without reshipment marks the origin waived in bulk facts and detail');
select public.admin_record_order_claim_origin_collection(pg_temp.ro_id('claim',3),pg_temp.ro_id('shipment',5),'TEST 김포 입고 확인',pg_temp.ro_today()-1) as gimpo_exchange \gset
select pg_temp.ro_assert(:'gimpo_exchange'='collected'
 and (select stage='collected' and collected_at is not null and collection_received_on=pg_temp.ro_today()-1 from public.order_cancellation_requests where id=pg_temp.ro_id('claim',3))
 and (select count(*)=1 from public.notifications n where n.user_id=pg_temp.ro_id('user',2) and n.title='반송이 필요한 굿즈가 모두 입고됐어요'
  and n.body='반송이 필요한 굿즈의 입고가 모두 확인되어 후속 처리를 준비합니다. 일부 상품은 회수 없이 다시 보내드려요.' and n.source_id=pg_temp.ro_id('claim',3)::text)
 and (select count(*)=1 from public.notifications where user_id=pg_temp.ro_id('user',2) and source_id=pg_temp.ro_id('claim',3)::text and dedupe_key like 'claim:collected%')
 and not exists(select 1 from public.notifications where user_id=pg_temp.ro_id('user',2) and source_id=pg_temp.ro_id('claim',3)::text and title='반송한 굿즈가 모두 입고됐어요'),
 'completion with a waived origin tells the customer that part was resent without return');

-- 회수 생략 배송 건이 늦게 도착하면 기록은 남기되(옛 3인자 경로 = 입고일 오늘) 재고·단계·회수 완료일·알림은 그대로다.
select pg_temp.ro_stock('ro-good-2') as stock_before \gset
select public.admin_record_order_claim_origin_collection(pg_temp.ro_id('claim',3),pg_temp.ro_id('shipment',6),'TEST 남양주 늦게 도착') as late \gset
select pg_temp.ro_assert(:'late'='collected' and pg_temp.ro_stock('ro-good-2')=:'stock_before'::integer
 and (select collected_at is not null and received_on=pg_temp.ro_today() from public.order_claim_collections where claim_id=pg_temp.ro_id('claim',3) and shipment_id=pg_temp.ro_id('shipment',6))
 and (select stage='collected' and collection_received_on=pg_temp.ro_today()-1 from public.order_cancellation_requests where id=pg_temp.ro_id('claim',3))
 and (select count(*)=1 from public.notifications where user_id=pg_temp.ro_id('user',2) and source_id=pg_temp.ro_id('claim',3)::text and dedupe_key like 'claim:collected%')
 and (select diff->>'collectionWaived'='true' from public.audit_log where action='admin.order.claim_origin_collected' and diff->>'shipmentId'=pg_temp.ro_id('shipment',6)::text)
 and (select count(*)=1 from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.ro_id('claim',3))#>'{claim,collections}') x where x->>'collectionWaived'='true'),
 'late arrival of a waived origin is recorded without stock, stage or notification change');

-- 회수 생략 판정은 결정 표의 규칙을 그대로 따른다: 하자·오배송 교환이 아니게 되면 결정은 회수를 대신하지 않는다.
update public.order_cancellation_requests set reason_type='change_of_mind' where id=pg_temp.ro_id('claim',3);
select pg_temp.ro_assert(not private.claim_collection_waived(pg_temp.ro_id('claim',3),pg_temp.ro_id('shipment',6))
 and (select not (x->>'waived')::boolean from jsonb_array_elements(public.admin_order_claim_bulk_context(array[pg_temp.ro_id('claim',3)])->0->'collections') x
  where x->>'originName'='TEST 남양주'),
 'bulk facts follow the decision truth source when the claim stops being a defect exchange');

-- 회수 생략 결정이 효력을 잃으면(반품 전환, T11a 트리거 private.reopen_ineffective_collection_waivers) 아직 돌아오지 않은
-- 배송 건 때문에 입고완료가 수거중으로 돌아가고 확인 시각과 회수 완료일이 함께 빈다(환급 기한이 실제 반환 전부터 흐르지
-- 않는다). 그 배송 건이 실제로 돌아와 회수가 다시 끝나면 회수 완료일은 확인된 출고지 행에서 다시 세고(앞선 이틀 전이 아니다),
-- 회수 완료 알림은 실제 상태("반송한 굿즈가 모두 입고")로 2회차 키로 다시 간다.
insert into private.claim_evidence_files(id,claim_id,actor_id,mime_type,size_bytes,sha256,path)
 values(pg_temp.ro_id('file',2),pg_temp.ro_id('claim',9),pg_temp.ro_id('user',1),'image/png',10,repeat('b',64),pg_temp.ro_id('claim',9)::text||'/'||pg_temp.ro_id('file',2)::text||'.png');
select public.admin_waive_order_claim_collection(pg_temp.ro_id('claim',9),pg_temp.ro_id('shipment',8),
 jsonb_build_object('reason','TEST 파손 사진으로 회수 생략 결정','evidenceFileIds',jsonb_build_array(pg_temp.ro_id('file',2))))->>'replayed' as reopen_waiver \gset
select public.admin_record_order_claim_origin_collection(pg_temp.ro_id('claim',9),pg_temp.ro_id('shipment',7),'TEST 김포 입고 확인',pg_temp.ro_today()-2) as reopen_first \gset
select pg_temp.ro_assert(:'reopen_waiver'='false' and :'reopen_first'='collected'
 and (select stage='collected' and collected_at is not null and collection_received_on=pg_temp.ro_today()-2 from public.order_cancellation_requests where id=pg_temp.ro_id('claim',9))
 and (select count(*)=1 from public.notifications where user_id=pg_temp.ro_id('user',2) and source_id=pg_temp.ro_id('claim',9)::text
  and title='반송이 필요한 굿즈가 모두 입고됐어요' and dedupe_key like 'claim:collected:'||pg_temp.ro_id('claim',9)::text||':%'),
 'a waived origin lets the other origin complete the claim');
select public.admin_convert_order_claim_type(pg_temp.ro_id('claim',9),pg_temp.ro_id('conv-op',9),c.claim_revision,'return','TEST 고객 요청으로 반품 전환',true,null) is not null as reopen_converted
 from public.order_cancellation_requests c where c.id=pg_temp.ro_id('claim',9) \gset
select public.admin_order_claim_bulk_context(array[pg_temp.ro_id('claim',9)])->0 as reopened \gset
select pg_temp.ro_assert(:'reopen_converted'::boolean
 and (select claim_type='return' and stage='collecting' and collected_at is null and collection_received_on is null
  from public.order_cancellation_requests where id=pg_temp.ro_id('claim',9))
 and exists(select 1 from public.audit_log where action='admin.order.claim_collection_reopened' and diff->>'claimId'=pg_temp.ro_id('claim',9)::text)
 and not private.claim_collection_waived(pg_temp.ro_id('claim',9),pg_temp.ro_id('shipment',8))
 and (:'reopened'::jsonb)->>'refundBlocker'='claim_collections_incomplete' and (:'reopened'::jsonb)->'collectionReceivedOn'='null'::jsonb
 and (:'reopened'::jsonb)->'collectedAt'='null'::jsonb and not ((:'reopened'::jsonb)->>'collectionComplete')::boolean
 and (select count(*)=1 from jsonb_array_elements((:'reopened'::jsonb)->'collections') y where y->>'collectedAt' is null and not (y->>'waived')::boolean)
 and public.admin_order_claim_detail(pg_temp.ro_id('claim',9))#>'{claim,collectionReceivedOn}'='null'::jsonb,
 'an ineffective waiver reopens the collection and clears the received date');
-- 되돌림 뒤 실제 입고는 회수 완료 2회차다. 중복 방지 키에 회차가 들어가(claim:collected:2:<id>:<updated_at>) 같은
-- 트랜잭션(같은 updated_at)이어도 앞 회차 안내에 막히지 않는다.
select public.admin_record_order_claim_origin_collection(pg_temp.ro_id('claim',9),pg_temp.ro_id('shipment',8),'TEST 남양주 실제 입고',pg_temp.ro_today()) as reopen_again \gset
select public.admin_order_claim_bulk_context(array[pg_temp.ro_id('claim',9)])->0 as recollected \gset
select pg_temp.ro_assert(:'reopen_again'='collected'
 and (select stage='collected' and collected_at is not null and collection_received_on=pg_temp.ro_today() from public.order_cancellation_requests where id=pg_temp.ro_id('claim',9))
 and public.admin_order_claim_detail(pg_temp.ro_id('claim',9))#>>'{claim,collectionReceivedOn}'=pg_temp.ro_today()::text
 and (:'recollected'::jsonb)->'refundBlocker'='null'::jsonb and (:'recollected'::jsonb)->>'collectionReceivedOn'=pg_temp.ro_today()::text
 and (select count(*)=2 from jsonb_array_elements(public.admin_order_claim_detail(pg_temp.ro_id('claim',9))#>'{claim,collections}') x
  where x->>'collectedAt' is not null and x->>'collectionWaived'='false')
 and (select count(*)=2
   and count(*) filter(where title='반송이 필요한 굿즈가 모두 입고됐어요' and dedupe_key like 'claim:collected:'||pg_temp.ro_id('claim',9)::text||':%')=1
   and count(*) filter(where title='반송한 굿즈가 모두 입고됐어요' and body='모든 출고지의 입고가 확인되어 후속 처리를 준비합니다.'
    and dedupe_key like 'claim:collected:2:'||pg_temp.ro_id('claim',9)::text||':%')=1
  from public.notifications where user_id=pg_temp.ro_id('user',2) and source_id=pg_temp.ro_id('claim',9)::text and dedupe_key like 'claim:collected%'),
 'the real return completes again with a recounted received date and an accurate notice');

-- 정방향 완료(입고 → 결정): 김포 입고 뒤 남양주 회수 생략을 결정하면 그때 회수 완료다(입고완료·완료일=김포 입고일·알림 1건·
-- 감사). 결정 → 입고 순서(주문 3)와 같은 완료가 된다. 같은 결정의 재전송은 아무것도 바꾸지 않는다.
create function pg_temp.ro_waiver(n integer,f integer) returns jsonb language sql immutable as $$
 select jsonb_build_object('reason','TEST 파손 사진으로 회수 생략 결정 '||n,'evidenceFileIds',jsonb_build_array(pg_temp.ro_id('file',f)))$$;
create function pg_temp.ro_notices(n integer) returns bigint language sql stable as $$
 select count(*) from public.notifications where user_id=pg_temp.ro_id('user',2) and source_id=pg_temp.ro_id('claim',n)::text and dedupe_key like 'claim:collected%'$$;
create function pg_temp.ro_completions(n integer,cause text) returns bigint language sql stable as $$
 select count(*) from public.audit_log where action='admin.order.claim_collection_completed' and diff->>'claimId'=pg_temp.ro_id('claim',n)::text and diff->>'cause'=cause$$;
-- 인자 이름이 클레임 열(reason_type·reason)과 겹치면 열이 이기므로 p_ 이름을 쓴다.
create function pg_temp.ro_reason(n integer,op integer,p_type text,p_text text) returns boolean language sql volatile as $$
 select public.admin_change_order_claim_reason(c.id,pg_temp.ro_id('reason-op',op),c.claim_revision,pg_temp.ro_id('user',1),p_type,p_text,'TEST 고객과 통화로 확인',true,true) is not null
 from public.order_cancellation_requests c where c.id=pg_temp.ro_id('claim',n)$$;
insert into private.claim_evidence_files(id,claim_id,actor_id,mime_type,size_bytes,sha256,path)
 select pg_temp.ro_id('file',f),pg_temp.ro_id('claim',n),pg_temp.ro_id('user',1),'image/png',10,repeat(f::text,64),pg_temp.ro_id('claim',n)::text||'/'||pg_temp.ro_id('file',f)::text||'.png'
 from (values(10,3),(11,4),(12,5),(12,6)) spec(n,f);
select public.admin_record_order_claim_origin_collection(pg_temp.ro_id('claim',10),pg_temp.ro_id('shipment',10),'TEST 김포 먼저 입고',pg_temp.ro_today()-1) as fwd_first \gset
select (select stage from public.order_cancellation_requests where id=pg_temp.ro_id('claim',10)) as fwd_before \gset
select public.admin_waive_order_claim_collection(pg_temp.ro_id('claim',10),pg_temp.ro_id('shipment',11),pg_temp.ro_waiver(10,3))->>'replayed' as fwd_waiver \gset
select pg_temp.ro_assert(:'fwd_first'='collecting' and :'fwd_before'='collecting' and :'fwd_waiver'='false'
 and (select stage='collected' and collected_at is not null and collection_received_on=pg_temp.ro_today()-1 from public.order_cancellation_requests where id=pg_temp.ro_id('claim',10))
 and pg_temp.ro_notices(10)=1
 and exists(select 1 from public.notifications where source_id=pg_temp.ro_id('claim',10)::text and title='반송이 필요한 굿즈가 모두 입고됐어요'
  and dedupe_key like 'claim:collected:'||pg_temp.ro_id('claim',10)::text||':%')
 and pg_temp.ro_completions(10,'collection_waiver_decided')=1,
 'a waiver decided after the other origin arrived completes the collection once');
select collected_at::text as fwd_collected_at,claim_revision as fwd_revision from public.order_cancellation_requests where id=pg_temp.ro_id('claim',10) \gset
select public.admin_waive_order_claim_collection(pg_temp.ro_id('claim',10),pg_temp.ro_id('shipment',11),pg_temp.ro_waiver(10,3))->>'replayed' as fwd_replay \gset
select pg_temp.ro_assert(:'fwd_replay'='true'
 and (select collected_at::text=:'fwd_collected_at' and stage='collected' from public.order_cancellation_requests where id=pg_temp.ro_id('claim',10))
 and pg_temp.ro_notices(10)=1 and pg_temp.ro_completions(10,'collection_waiver_decided')=1,
 'replaying the waiver on a completed collection changes nothing');

-- 사유 되돌림(T1): 하자 → 단순 변심이면 결정이 효력을 잃어 수거중으로 돌아가고(완료일 비움), 다시 하자로 정정하면 결정이 효력을
-- 얻어 회수 완료 2회차(입고완료·완료일·알림·감사)가 된다.
select pg_temp.ro_reason(10,1,'change_of_mind','TEST 단순 변심으로 정정') as fwd_cm \gset
select pg_temp.ro_assert(:'fwd_cm'::boolean
 and (select stage='collecting' and collected_at is null and collection_received_on is null from public.order_cancellation_requests where id=pg_temp.ro_id('claim',10))
 and exists(select 1 from public.audit_log where action='admin.order.claim_collection_reopened' and diff->>'claimId'=pg_temp.ro_id('claim',10)::text)
 and pg_temp.ro_completions(10,'collection_waiver_effective')=0 and pg_temp.ro_notices(10)=1,
 'a change-of-mind correction reopens the collection');
select pg_temp.ro_reason(10,2,'defect','TEST 하자로 다시 정정') as fwd_defect \gset
select pg_temp.ro_assert(:'fwd_defect'::boolean
 and (select stage='collected' and collected_at is not null and collection_received_on=pg_temp.ro_today()-1 and reason_type='defect'
  from public.order_cancellation_requests where id=pg_temp.ro_id('claim',10))
 and pg_temp.ro_completions(10,'collection_waiver_effective')=1 and pg_temp.ro_notices(10)=2
 and exists(select 1 from public.notifications where source_id=pg_temp.ro_id('claim',10)::text and title='반송이 필요한 굿즈가 모두 입고됐어요'
  and dedupe_key like 'claim:collected:2:'||pg_temp.ro_id('claim',10)::text||':%'),
 'restoring the defect reason completes the collection again as round two');

-- 보류 대칭: 입고완료에서 보류한 요청은 되돌림 때 보류 전 단계가 수거중이 되고, 결정이 다시 효력을 얻으면 보류 전 단계가 입고완료가
-- 된다(보류는 그대로).
select public.admin_record_order_claim_origin_collection(pg_temp.ro_id('claim',11),pg_temp.ro_id('shipment',12),'TEST 김포 먼저 입고',pg_temp.ro_today()-2) as held_first \gset
select public.admin_waive_order_claim_collection(pg_temp.ro_id('claim',11),pg_temp.ro_id('shipment',13),pg_temp.ro_waiver(11,4))->>'replayed' as held_waiver \gset
select public.admin_change_order_claim_hold(c.id,pg_temp.ro_id('hold-op',1),c.claim_revision,'exchange','hold','TEST 고객 추가 사진 확인을 기다립니다',pg_temp.ro_id('user',1)) is not null as held
 from public.order_cancellation_requests c where c.id=pg_temp.ro_id('claim',11) \gset
select pg_temp.ro_assert(:'held_first'='collecting' and :'held_waiver'='false' and :'held'::boolean
 and (select stage='on_hold' and held_from='collected' and collected_at is not null from public.order_cancellation_requests where id=pg_temp.ro_id('claim',11)),
 'the completed collection is held');
select pg_temp.ro_reason(11,3,'change_of_mind','TEST 단순 변심으로 정정') as held_cm \gset
select pg_temp.ro_assert(:'held_cm'::boolean
 and (select stage='on_hold' and held_from='collecting' and collected_at is null and collection_received_on is null from public.order_cancellation_requests where id=pg_temp.ro_id('claim',11)),
 'reopening a held claim moves its held-from stage back to collecting');
select pg_temp.ro_reason(11,4,'defect','TEST 하자로 다시 정정') as held_defect \gset
select pg_temp.ro_assert(:'held_defect'::boolean
 and (select stage='on_hold' and held_from='collected' and collected_at is not null and collection_received_on=pg_temp.ro_today()-2
  from public.order_cancellation_requests where id=pg_temp.ro_id('claim',11))
 and pg_temp.ro_completions(11,'collection_waiver_effective')=1 and pg_temp.ro_notices(11)=2,
 'an effective waiver completes a held claim behind its hold');

-- 모두 회수 생략: 두 배송 건을 모두 결정해도 실제 입고가 없으므로 회수 완료로 적지 않는다(교환은 재출고로 끝난다).
select public.admin_waive_order_claim_collection(pg_temp.ro_id('claim',12),pg_temp.ro_id('shipment',14),pg_temp.ro_waiver(12,5))->>'replayed' as all_first \gset
select public.admin_waive_order_claim_collection(pg_temp.ro_id('claim',12),pg_temp.ro_id('shipment',15),pg_temp.ro_waiver(12,6))->>'replayed' as all_second \gset
select pg_temp.ro_assert(:'all_first'='false' and :'all_second'='false' and private.claim_collections_complete(pg_temp.ro_id('claim',12))
 and (select stage='collecting' and collected_at is null and collection_received_on is null from public.order_cancellation_requests where id=pg_temp.ro_id('claim',12))
 and pg_temp.ro_notices(12)=0 and pg_temp.ro_completions(12,'collection_waiver_decided')=0,
 'waiving every origin without any arrival does not record a collection');

-- 입력 계약.
select pg_temp.ro_error('select public.admin_order_claim_bulk_context(array[]::uuid[])','invalid_claim_bulk_ids');
select pg_temp.ro_error(format('select public.admin_order_claim_bulk_context(array[%L::uuid,null])',pg_temp.ro_id('claim',1)),'invalid_claim_bulk_ids');
select pg_temp.ro_error('select public.admin_order_claim_bulk_context(array(select gen_random_uuid() from generate_series(1,51)))','invalid_claim_bulk_ids');
-- 운영자가 아니면 읽지 못한다.
select set_config('request.jwt.claim.sub',pg_temp.ro_id('user',2)::text,true);
select pg_temp.ro_error(format('select public.admin_order_claim_bulk_context(array[%L::uuid])',pg_temp.ro_id('claim',1)),'42501');
select pg_temp.ro_error(format('select public.admin_record_order_claim_origin_collection(%L,%L,''고객 시도'',%L::date)',pg_temp.ro_id('claim',1),pg_temp.ro_id('shipment',1),pg_temp.ro_today()),'42501');
rollback;
