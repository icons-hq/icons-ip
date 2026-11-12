\set ON_ERROR_STOP on
-- 반품 자동 회수 접수(QNA-032·ADR-0034)의 DB 계약.
-- 1. 스위치를 켠 적이 없으면 지금과 같다: 큐를 만들지 않고, 회수 묶음 읽기(운영·고객)에 키를 더하지 않고, 운영 요약은 꺼짐뿐이다.
-- 2. 켜려면 서비스 이름·근거·시각이 필요하고, 바꿀 때마다 감사 기록이 남는다. 행은 지우지 못한다.
-- 3. 켠 뒤 승인된 회수 묶음만, 회수 계약을 켠 출고지만 큐에 들어간다(승인 트랜잭션 밖 — 크론의 work가 넣는다).
--    고객이 이미 보냈다고 기록된 배송 건·운영자가 회수 방법을 따로 기록한 배송 건은 넣지 않는다.
-- 4. 접수 성공은 회수 송장을 저장하고 클레임 회수 이력·감사(개인정보 없음)·고객 알림을 남긴다. 고객 회수 주소 읽기에 회수 송장이 보인다.
-- 5. 실패는 '자동 수거 실패'로 세고 상한까지 다시 시도한다. 운영자가 다시 접수하면 같은 멱등 키로 다시 보낸다.
-- 6. 철회·거절·고객 직접 발송으로 필요 없어지면 접수 전은 그냥 닫고, 접수됐으면 취소를 맡긴다. 입고되면 접수는 끝난다.
-- 7. 임대(lease)가 바뀐 결과는 받지 않는다. 회수 주소 정정(암호문)이 있으면 그 암호문을 앱에 넘긴다.
-- 8. 고객 안내는 회수 묶음 단위다: 방문 회수 묶음 수와 직접 보낼 묶음 수(혼합 출고지), 선물은 받는 분만, 꺼진 뒤 pending·failed는 방문 회수가 아니다.
-- 9. 요청이 나가는 사이 철회되면 접수됐다고 알리지 않고 바로 취소로 돌린다. 시간 예산이 끝난 일(deferred)은 시도 횟수를 소모하지 않는다.
-- 10. 출고지 계약·전체 스위치를 껐다 다시 켜면 켠 시각이 새로 적혀, 꺼져 있던 동안 승인된 묶음은 접수하지 않는다. 회수 생략 배송 건은 접수하지 않는다.
-- 합성 데이터만 쓰고 롤백한다. 택배사 API는 부르지 않는다.
begin;
load 'safeupdate';
create function pg_temp.rp_id(kind text,n integer) returns uuid language sql immutable as $$select md5('claim-return-pickup:'||kind||':'||n)::uuid$$;
create function pg_temp.rp_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'return-pickup assertion: %',label;end if;end$$;
create function pg_temp.rp_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected return-pickup rejection: %',expected;end$$;
create function pg_temp.rp_as(n integer) returns void language sql as $$
 select set_config('request.jwt.claim.sub',pg_temp.rp_id('user',n)::text,true);
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rp_id('user',n),'role','authenticated','session_id',pg_temp.rp_id('session',n))::text,true);
$$;

-- 1. 진입점·표의 권한. 서비스 경로는 service_role만, 운영 경로는 로그인 운영자만, 공개 안내 판정은 익명도 읽는다.
select pg_temp.rp_assert(
 has_function_privilege('service_role','public.service_return_pickup_work(integer)','execute')
 and not has_function_privilege('authenticated','public.service_return_pickup_work(integer)','execute')
 and not has_function_privilege('anon','public.service_return_pickup_work(integer)','execute')
 and has_function_privilege('service_role','public.service_record_return_pickup_results(jsonb)','execute')
 and not has_function_privilege('authenticated','public.service_record_return_pickup_results(jsonb)','execute')
 and not has_function_privilege('anon','public.service_record_return_pickup_results(jsonb)','execute')
 and has_function_privilege('authenticated','public.admin_retry_claim_return_pickup(uuid,uuid)','execute')
 and not has_function_privilege('anon','public.admin_retry_claim_return_pickup(uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_retry_claim_return_pickup(uuid,uuid)','execute')
 and has_function_privilege('authenticated','public.admin_claim_return_operations()','execute')
 and not has_function_privilege('anon','public.admin_claim_return_operations()','execute')
 and not has_function_privilege('service_role','public.admin_claim_return_operations()','execute')
 and has_function_privilege('anon','public.get_good_return_pickup(text)','execute')
 and not has_function_privilege('service_role','public.get_good_return_pickup(text)','execute')
 and has_function_privilege('authenticated','public.get_my_order_return_pickup(uuid)','execute')
 and not has_function_privilege('anon','public.get_my_order_return_pickup(uuid)','execute')
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in('claim_return_pickup_block','claim_return_pickup_eligible','claim_return_pickup_json','claim_return_pickup_sender',
   'claim_return_pickup_request_item','claim_return_pickup_next_attempt','audit_return_pickup_settings','return_intake_columns_valid','claim_collection_bundles_json')
  and(has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')))
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private'
  and c.relname in('return_pickup_settings','return_pickup_origins','claim_return_pickups','claim_return_pickup_attempts')
  and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'select') or has_table_privilege('authenticated',c.oid,'select') or has_table_privilege('service_role',c.oid,'select')))
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_retry_claim_return_pickup(uuid,uuid)' and capability='sales.manage' and guard_kind='write')
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_claim_return_operations()' and capability='sales.manage' and guard_kind='read'),
 'entry points and tables are scoped');

-- 기본은 꺼짐이다.
select pg_temp.rp_assert((select not pickup_enabled and provider is null and pickup_enabled_at is null and not intake_enabled from private.return_pickup_settings where singleton),
 'switch ships off');

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.rp_id('user',n),'authenticated','authenticated','claim-return-pickup-'||n||'@example.test',now(),'{}','{}' from generate_series(1,4)n;
update public.profiles set nickname='TEST 회수 접수 '||right(id::text,6),
 role=case when id in(pg_temp.rp_id('user',2),pg_temp.rp_id('user',4)) then 'user'::public.user_role else 'admin'::public.user_role end
 where id in(select pg_temp.rp_id('user',n) from generate_series(1,4)n);
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) select pg_temp.rp_id('session',n),pg_temp.rp_id('user',n),now(),now(),'aal1',now()+interval '1 hour' from generate_series(1,4)n;
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.rp_id('user',3),'owner' where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.rp_id('user',1),'primary');
update private.operator_access_state set configured=true where id;

insert into public.ips(id,title,vertical_key) values('rp-ip','TEST 회수 접수','character');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values
 (pg_temp.rp_id('origin',1),'rp-gimpo','TEST 김포','hanjin',0,'TEST 김포 반송지 1',true),
 (pg_temp.rp_id('origin',2),'rp-namyangju','TEST 남양주','epost',0,'TEST 남양주 반송지 2',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
 ('rp-good-1','rp-ip','TEST 김포 굿즈','문구',1000,'ok',50,pg_temp.rp_id('origin',1)),
 ('rp-good-2','rp-ip','TEST 남양주 굿즈','문구',2000,'ok',50,pg_temp.rp_id('origin',2));
create function pg_temp.rp_default(good text) returns uuid language sql stable as $$select id from public.goods_variants where good_id=good and is_default$$;

-- 주문 1~9·11~20: 김포 굿즈 한 줄(반품). 주문 10: 남양주 굿즈(회수 계약 없는 출고지). 주문 13은 김포·남양주 두 배송 건(혼합), 주문 14는 선물,
-- 주문 18·19는 회수 생략 하자 교환. 모든 주문은 닷새 전에 만들었다.
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at,created_at)
 select pg_temp.rp_id('order',n),pg_temp.rp_id('user',2),'delivered',5000,0,
  jsonb_build_object('recipientName','합성 고객 '||n,'phone','010-5555-'||lpad(n::text,4,'0'),'postalCode','12345','address1','합성시 회수로 '||n,'address2','10'||n||'호'),
  now()-interval '4 days',now()-interval '3 days',now()-interval '5 days' from generate_series(1,20)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.rp_id('item',n),pg_temp.rp_id('order',n),case when n=10 then 'rp-good-2' else 'rp-good-1' end,
  pg_temp.rp_default(case when n=10 then 'rp-good-2' else 'rp-good-1' end),1,1000,'TEST 회수 굿즈 '||n,'문구','rp-ip' from generate_series(1,20)n;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at)
 select pg_temp.rp_id('shipment',n),pg_temp.rp_id('order',n),case when n=10 then pg_temp.rp_id('origin',2) else pg_temp.rp_id('origin',1) end,
  case when n=10 then 'TEST 남양주' else 'TEST 김포' end,0,'{}','delivered','hanjin','RPSALE'||lpad(n::text,6,'0'),now()-interval '4 days',now()-interval '3 days'
 from generate_series(1,20)n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) select pg_temp.rp_id('order',n),pg_temp.rp_id('shipment',n),pg_temp.rp_id('item',n),1 from generate_series(1,20)n;
insert into public.payments(id,user_id,purpose,ref_id,amount,status,idempotency_key,provider)
 select pg_temp.rp_id('payment',n),pg_temp.rp_id('user',2),'order',pg_temp.rp_id('order',n),5000,'paid','rp-pay-'||n,'toss' from generate_series(1,20)n;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type)
 select pg_temp.rp_id('claim',n),pg_temp.rp_id('order',n),pg_temp.rp_id('user',2),'TEST 회수 접수 반품 '||n,case when n in(18,19) then 'exchange' else 'return' end,'requested',case when n in(18,19) then 'defect' else 'change_of_mind' end from generate_series(1,20)n;
-- 주문 13의 두 번째 배송 건(남양주 — 회수 계약 없는 출고지).
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 values(pg_temp.rp_id('item',113),pg_temp.rp_id('order',13),'rp-good-2',pg_temp.rp_default('rp-good-2'),1,1000,'TEST 회수 굿즈 113','문구','rp-ip');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at)
 values(pg_temp.rp_id('shipment',113),pg_temp.rp_id('order',13),pg_temp.rp_id('origin',2),'TEST 남양주',0,'{}','delivered','epost','RPSALE000113',now()-interval '4 days',now()-interval '3 days');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(pg_temp.rp_id('order',13),pg_temp.rp_id('shipment',113),pg_temp.rp_id('item',113),1);
-- 주문 14: 선물(보낸 분 = 주문자 2, 받는 분 = 4).
insert into private.gift_intents(id,sender_id,recipient_id,state,sender_label,recipient_label,expires_at,order_id,ordered_source_revision)
 values(pg_temp.rp_id('gift',14),pg_temp.rp_id('user',2),pg_temp.rp_id('user',4),'ordered','TEST sender','TEST recipient',now()+interval '1 day',pg_temp.rp_id('order',14),'1:synthetic');

select set_config('request.jwt.claim.role','service_role',true);
select pg_temp.rp_as(1);

-- 2. 꺼진 상태: 승인해도 큐가 생기지 않고, 읽기 모양이 그대로다.
select public.admin_decide_order_claim(pg_temp.rp_id('claim',1),'approve',null);
select public.service_return_pickup_work(10) as off_work \gset
select pg_temp.rp_assert(:'off_work'::jsonb='{"enabled":false}'::jsonb and not exists(select 1 from private.claim_return_pickups), 'off: work does nothing');
select pg_temp.rp_assert(public.admin_claim_return_operations()='{"pickup":{"enabled":false},"intake":{"enabled":false}}'::jsonb, 'off: operator summary is only off');
select pg_temp.rp_assert(not public.get_good_return_pickup('rp-good-1') and (select (public.get_my_order_return_pickup(pg_temp.rp_id('order',1))->>'pickupBundles')::integer=0), 'off: customer notices unchanged');
select pg_temp.rp_assert(
 (select array_agg(key order by key) from jsonb_object_keys(private.claim_collection_bundles_json(pg_temp.rp_id('claim',1),pg_temp.rp_id('shipment',1),true)->0) key)
  = array['bundleId','collectedAt','collectedBy','collectorName','evidence','items','receivedOn','returnAddress','returnAddressId','returnAddressReady','returnName','returnPhone']
 and (select array_agg(key order by key) from jsonb_object_keys(private.claim_collection_bundles_json(pg_temp.rp_id('claim',1),pg_temp.rp_id('shipment',1),false)->0) key)
  = array['bundleId','collectedAt','items','returnAddress','returnName','returnPhone'],
 'off: bundle documents keep the T14a keys');
select pg_temp.rp_error(format('select public.admin_retry_claim_return_pickup(%L,%L)',pg_temp.rp_id('claim',1),pg_temp.rp_id('claim',1)),'return_pickup_disabled');

-- 켜려면 서비스 이름·근거·시각이 함께 필요하다. 행은 지우지 못하고, 바꾸면 리비전과 감사 기록이 남는다.
select pg_temp.rp_error($q$update private.return_pickup_settings set pickup_enabled=true where singleton$q$,'23514');
select pg_temp.rp_error($q$delete from private.return_pickup_settings where singleton$q$,'return_pickup_settings_required');
select pg_temp.rp_error($q$update private.return_pickup_settings set intake_columns='{"trackingNumber":["송장"],"orderNumber":["송장"],"phone":["연락처"],"receivedOn":["입고일"]}' where singleton$q$,'23514');
update private.return_pickup_settings set pickup_enabled=true,provider='fake',pickup_evidence='TEST 회수 계약 시험',pickup_enabled_at=clock_timestamp() where singleton;
select pg_temp.rp_assert((select revision=2 from private.return_pickup_settings where singleton)
 and exists(select 1 from public.audit_log where action='system.return_pickup.settings_changed' and target='return_pickup_settings' and diff#>>'{after,pickup_enabled}'='true'),
 'switch change is revisioned and audited');
-- 켰지만 출고지 계약이 없으면 아무것도 넣지 않는다.
select pg_temp.rp_assert((public.service_return_pickup_work(10)->'items')='[]'::jsonb and not exists(select 1 from private.claim_return_pickups), 'no origin contract, no queue');
insert into private.return_pickup_origins(origin_id,carrier,evidence) values(pg_temp.rp_id('origin',1),'hanjin','TEST 김포 한진 회수 계약');
select pg_temp.rp_assert(exists(select 1 from public.audit_log where action='system.return_pickup.settings_changed' and target='return_pickup_origins'), 'origin contract audited');
select pg_temp.rp_assert(public.get_good_return_pickup('rp-good-1') and not public.get_good_return_pickup('rp-good-2'), 'detail notice follows the origin contract');

-- 3. 켜기 전에 승인된 주문 1은 넣지 않는다. 켠 뒤 승인한 주문 2·3·4·5·6·7·8과 계약 없는 남양주 주문 10.
select public.admin_decide_order_claim(pg_temp.rp_id('claim',n),'approve',null) from unnest(array[2,3,4,5,6,7,8,10])n;
-- 주문 7: 고객이 이미 보냈다고 기록된 배송 건. 주문 8: 운영자가 회수 방법을 따로 기록한 배송 건.
insert into private.claim_collection_plans(claim_id,shipment_id,revision,method,carrier,tracking_number,evidence,requested_once,customer_sent_once) values
 (pg_temp.rp_id('claim',7),pg_temp.rp_id('shipment',7),1,'customer_sent','hanjin','RPCUSTSENT007','TEST 고객 발송',true,true),
 (pg_temp.rp_id('claim',8),pg_temp.rp_id('shipment',8),1,'seller_arranged','hanjin','RPMANUAL00008','TEST 운영자 접수',true,false);
-- 주문 6은 회수 주소 정정(암호문)이 있다 — 앱이 키로 열 수 있게 암호문을 그대로 넘긴다.
insert into private.order_claim_contact_plans(id,order_id,claim_id,target,revision,pii_version,sealed_plan)
 values(pg_temp.rp_id('plan',6),pg_temp.rp_id('order',6),pg_temp.rp_id('claim',6),'collection',1,pg_temp.rp_id('pii',6),
  jsonb_build_object('planId',pg_temp.rp_id('plan',6),'piiVersion',pg_temp.rp_id('pii',6),'keyVersion','k1','addressHmac',repeat('a',64),'addressHmacKeyVersion','k1',
   'address',jsonb_build_object('recipientName','sealed')));

select public.service_return_pickup_work(3) as first_work \gset
select pg_temp.rp_assert((:'first_work'::jsonb->>'enabled')::boolean and (:'first_work'::jsonb->>'queued')::integer=5
 and (select array_agg(claim_id order by claim_id) from private.claim_return_pickups)
  =(select array_agg(pg_temp.rp_id('claim',n) order by pg_temp.rp_id('claim',n)) from unnest(array[2,3,4,5,6])n),
 'queue holds only post-switch bundles of contracted origins without manual collection');
select pg_temp.rp_assert(jsonb_array_length(:'first_work'::jsonb->'items')=3
 and (select count(*)=3 from private.claim_return_pickups where lease_token is not null and attempts=1)
 and (select bool_and(idempotency_key='icons-return-'||replace(bundle_id::text,'-','') and provider='fake' and carrier='hanjin' and state='pending') from private.claim_return_pickups),
 'work leases up to the limit with stable idempotency keys');
-- 넘긴 접수 한 건: 회수지(고객) 최소 필드, 반품지(받는 곳), 품목, 출고 운송장. 다른 회차는 임대한 행을 다시 받지 않는다.
create temp table rp_first as select value item from jsonb_array_elements(:'first_work'::jsonb->'items');
select pg_temp.rp_assert((select bool_and(item->>'kind'='request' and item->>'carrier'='hanjin' and item->'items'->0->>'qty'='1'
  and item#>>'{receiver,address}'='TEST 김포 반송지 1' and item#>>'{receiver,name}'='TEST 김포'
  and item->>'outboundTrackingNumber' like 'RPSALE%'
  and (item#>>'{sender,source}'='plain' and (select array_agg(k order by k) from jsonb_object_keys(item#>'{sender,address}') k)=array['address1','address2','phone','postalCode','recipientName']
   or item#>>'{sender,source}'='sealed' and item#>>'{sender,plan,planId}'=pg_temp.rp_id('plan',6)::text and not (item#>'{sender}' ? 'address'))) from rp_first),
 'request items carry minimal pickup fields');
select public.service_return_pickup_work(10) as second_work \gset
select pg_temp.rp_assert(jsonb_array_length(:'second_work'::jsonb->'items')=2
 and (select count(*)=5 from private.claim_return_pickups where lease_token is not null), 'second tick leases the remaining two only');
select pg_temp.rp_assert(jsonb_array_length(public.service_return_pickup_work(10)->'items')=0, 'leased rows are not handed out twice');

-- 4. 접수 성공: 주문 2. 임대 토큰이 틀린 결과는 stale.
select pg_temp.rp_assert((public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',gen_random_uuid(),
  'kind','request','outcome','requested','trackingNumber','RP-PICK-0002')))->>'stale')::integer=1 and p.state='pending', 'wrong lease is stale')
 from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',2);
select public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',p.lease_token,'kind','request',
 'outcome','requested','trackingNumber','rp-pick-0002','externalId','FAKE-RESERVATION-2'))) as ok_result
 from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',2) \gset
select pg_temp.rp_assert((:'ok_result'::jsonb->>'requested')::integer=1
 and (select state='requested' and tracking_number='RPPICK0002' and external_id='FAKE-RESERVATION-2' and lease_token is null and requested_at is not null
  from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',2)),
 'success stores the normalized pickup tracking');
select pg_temp.rp_assert(exists(select 1 from private.claim_collection_events e where e.claim_id=pg_temp.rp_id('claim',2) and e.request->>'source'='return_pickup'
  and e.request#>>'{values,method}'='seller_arranged' and e.request#>>'{values,trackingNumber}'='RPPICK0002' and e.request#>>'{values,evidence}' like '자동 회수 접수%')
 and exists(select 1 from public.audit_log where action='system.order.claim_return_pickup_requested' and diff->>'claimId'=pg_temp.rp_id('claim',2)::text
  and diff->>'trackingNumber'='RPPICK0002' and diff::text not like '%합성%' and diff::text not like '%010-5555%')
 and exists(select 1 from public.notifications where user_id=pg_temp.rp_id('user',2) and source_id=pg_temp.rp_id('claim',2)::text and title='방문 회수가 접수됐어요'),
 'success is recorded in collection history, audit without personal data, and customer notification');
-- 회수 문서의 이력은 지금 앱 파서가 읽는 모양이다(method·carrier·trackingNumber·evidence).
select pg_temp.rp_assert(exists(select 1 from jsonb_array_elements(private.claim_collection_document(pg_temp.rp_id('claim',2))->'history') h
 where h->>'method'='seller_arranged' and h->>'carrier'='hanjin' and h->>'trackingNumber'='RPPICK0002'), 'collection history shows the pickup');
-- 고객 회수 주소 읽기와 운영 상세에 회수 송장이 보인다.
select pg_temp.rp_as(2);
select public.read_my_claim_return_bundles(pg_temp.rp_id('claim',2),pg_temp.rp_id('user',2),pg_temp.rp_id('session',2)) as buyer_bundles \gset
select pg_temp.rp_assert((:'buyer_bundles'::jsonb#>'{0,returnBundles,0,pickup}')=jsonb_build_object('carrier','hanjin','carrierLabel','한진택배','trackingNumber','RPPICK0002',
  'requestedAt',(select requested_at from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',2))),
 'customer sees the pickup tracking only');
select pg_temp.rp_assert(public.get_my_order_return_pickup(pg_temp.rp_id('order',2))='{"pickupBundles":1,"directBundles":0}'::jsonb, 'buyer order detail switches to the visit notice');
select pg_temp.rp_as(4);
select pg_temp.rp_assert(public.get_my_order_return_pickup(pg_temp.rp_id('order',2))='{"pickupBundles":0,"directBundles":0}'::jsonb, 'another customer learns nothing');
select pg_temp.rp_as(1);
select pg_temp.rp_assert((select b->'pickup'->>'state'='requested' and b->'pickup'->>'trackingNumber'='RPPICK0002' and (b->'pickup'->>'inProgress')::boolean is false
 from jsonb_array_elements(private.claim_collection_bundles_json(pg_temp.rp_id('claim',2),pg_temp.rp_id('shipment',2),true)) b), 'operator bundle shows the pickup');
select pg_temp.rp_assert(not (private.claim_collection_bundles_json(pg_temp.rp_id('claim',1),pg_temp.rp_id('shipment',1),false)->0 ? 'pickup'), 'bundles without a pickup keep their shape');

-- 5. 실패: 주문 3. '자동 수거 실패'로 세고 다음 시도를 잡는다. 운영자가 다시 접수하면 바로 다시 보낸다.
select public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',p.lease_token,'kind','request',
 'outcome','error','errorCode','carrier_unavailable'))) from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',3);
select pg_temp.rp_assert((select state='failed' and last_error_code='carrier_unavailable' and next_attempt_at>clock_timestamp() and lease_token is null
 from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',3)), 'failure schedules a retry');
select pg_temp.rp_assert((public.admin_claim_return_operations()#>>'{pickup,failed}')::integer=1
 and public.admin_claim_return_operations()#>>'{pickup,items,0,claimId}'=pg_temp.rp_id('claim',3)::text
 and public.admin_claim_return_operations()#>>'{pickup,items,0,lastErrorCode}'='carrier_unavailable', 'failed pickups are counted for operators');
select pg_temp.rp_as(2);
select pg_temp.rp_error(format('select public.admin_retry_claim_return_pickup(%L,%L)',pg_temp.rp_id('claim',3),(select bundle_id from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',3))),'42501');
select pg_temp.rp_as(1);
select public.admin_retry_claim_return_pickup(pg_temp.rp_id('claim',3),(select bundle_id from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',3))) as retried \gset
select pg_temp.rp_assert(:'retried'::jsonb->>'state'='pending' and (select state='pending' and attempts=1 and retry_base=1 and next_attempt_at<=clock_timestamp()
  from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',3))
 and exists(select 1 from public.audit_log where action='admin.order.claim_return_pickup_retried' and actor_id=pg_temp.rp_id('user',1) and diff->>'previousState'='failed')
 and (public.admin_claim_return_operations()#>>'{pickup,failed}')::integer=0, 'operator retry requeues now and is audited');
select pg_temp.rp_assert((select (i->>'idempotencyKey')='icons-return-'||replace(p.bundle_id::text,'-','') from jsonb_array_elements(public.service_return_pickup_work(10)->'items') i
 join private.claim_return_pickups p on p.id=(i->>'pickupId')::uuid where p.claim_id=pg_temp.rp_id('claim',3)), 'retry is sent with the same idempotency key');
-- 상한: 자동 재시도 상한을 넘으면 다음 시도는 없다(운영자 재시도만).
update private.return_pickup_settings set max_attempts=1 where singleton;
select public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',p.lease_token,'kind','request',
 'outcome','error','errorCode','Bad Code!'))) from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',3);
select pg_temp.rp_assert((select state='failed' and attempts=2 and next_attempt_at is null and last_error_code='upstream_error'
 from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',3)), 'retry budget is exhausted and unknown codes are normalized');
update private.return_pickup_settings set max_attempts=5 where singleton;
-- 회수 송장 형식이 틀린 성공은 실패다.
select public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',p.lease_token,'kind','request',
 'outcome','requested','trackingNumber','12'))) from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',4);
select pg_temp.rp_assert((select state='failed' and last_error_code='invalid_tracking' from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',4)), 'invalid tracking is a failure');

-- 6. 필요 없어진 접수. 주문 2(접수됨)는 철회되면 취소를 맡긴다. 주문 4(실패, 보낸 적 있음)는 거절되면 취소를 맡긴다.
-- 주문 5(아직 보내지 않음)는 고객 직접 발송이 기록되면 그냥 닫는다.
update public.order_cancellation_requests set stage='withdrawn',withdrawn_at=clock_timestamp() where id=pg_temp.rp_id('claim',2);
update public.order_cancellation_requests set stage='rejected',decided_at=clock_timestamp() where id=pg_temp.rp_id('claim',4);
update private.claim_return_pickups set lease_token=null,lease_until=null,attempts=0 where claim_id=pg_temp.rp_id('claim',5);
insert into private.claim_collection_plans(claim_id,shipment_id,revision,method,carrier,tracking_number,evidence,requested_once,customer_sent_once)
 values(pg_temp.rp_id('claim',5),pg_temp.rp_id('shipment',5),1,'customer_sent','hanjin','RPCUSTSENT005','TEST 고객 발송',true,true);
select public.service_return_pickup_work(10) as cancel_work \gset
select pg_temp.rp_assert((select state='cancel_pending' and cancel_reason='withdrawn' and cancel_attempts=1 from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',2))
 and (select state='cancel_pending' and cancel_reason='rejected' from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',4))
 and (select state='canceled' and cancel_reason='customer_sent' and canceled_at is not null from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',5))
 and exists(select 1 from jsonb_array_elements(:'cancel_work'::jsonb->'items') i where i->>'kind'='cancel' and i->>'trackingNumber'='RPPICK0002' and i->>'externalId'='FAKE-RESERVATION-2'),
 'unneeded pickups are closed locally or handed to cancellation');
select public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',p.lease_token,'kind','cancel','outcome','canceled')))
 from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',2);
select public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',p.lease_token,'kind','cancel','outcome','error','errorCode','cancel_window_closed')))
 from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',4);
select pg_temp.rp_assert((select state='canceled' and canceled_at is not null from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',2))
 and exists(select 1 from private.claim_collection_events e where e.claim_id=pg_temp.rp_id('claim',2) and e.request#>>'{values,evidence}'='자동 회수 취소 · 요청 철회')
 and exists(select 1 from public.audit_log where action='system.order.claim_return_pickup_canceled' and diff->>'claimId'=pg_temp.rp_id('claim',2)::text and diff->>'reason'='withdrawn')
 and (select state='cancel_failed' and last_error_code='cancel_window_closed' from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',4))
 and (public.admin_claim_return_operations()#>>'{pickup,failed}')::integer=2, 'cancellation results are recorded; failed cancellations count as pickup failures');
-- 철회 뒤 고객 문서: 취소된 접수는 고객에게 보이지 않는다.
select pg_temp.rp_assert(not (private.claim_collection_bundles_json(pg_temp.rp_id('claim',2),pg_temp.rp_id('shipment',2),false)->0 ? 'pickup'), 'canceled pickups disappear for customers');

-- 7. 입고되면 접수는 끝난다(주문 6: 접수 → 입고 확인 → collected).
select public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',p.lease_token,'kind','request',
 'outcome','requested','trackingNumber','RPPICK0006'))) from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',6);
select public.admin_record_order_claim_origin_collection(pg_temp.rp_id('claim',6),pg_temp.rp_id('shipment',6),'TEST 김포 입고',(clock_timestamp() at time zone 'Asia/Seoul')::date);
select public.service_return_pickup_work(10);
select pg_temp.rp_assert((select state='collected' and tracking_number='RPPICK0006' from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',6)),
 'collected bundle closes its pickup');

-- 임대가 끝난(크론이 죽은) 접수는 새 토큰으로 다시 나가고, 옛 토큰의 결과는 받지 않는다.
update private.claim_return_pickups set state='pending',lease_token=gen_random_uuid(),lease_until=clock_timestamp()-interval '1 minute',
 next_attempt_at=clock_timestamp()-interval '1 minute' where claim_id=pg_temp.rp_id('claim',3);
create temp table rp_old_token as select lease_token token from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',3);
select pg_temp.rp_assert(exists(select 1 from jsonb_array_elements(public.service_return_pickup_work(10)->'items') i
 where (i->>'pickupId')::uuid=(select id from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',3))), 'expired lease is handed out again');
select pg_temp.rp_assert((public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',(select token from rp_old_token),
 'kind','request','outcome','requested','trackingNumber','RPPICKOLD03')))->>'stale')::integer=1 and p.state='pending', 'old lease results are ignored')
 from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',3);

-- 형식이 틀린 결과 목록은 거절하고, 알아볼 수 없는 결과 한 건은 세기만 한다.
select pg_temp.rp_error($q$select public.service_record_return_pickup_results('{}'::jsonb)$q$,'invalid_return_pickup_results');
select pg_temp.rp_assert((public.service_record_return_pickup_results('[{"pickupId":"x"}]'::jsonb)->>'invalid')::integer=1, 'malformed result is counted');
select pg_temp.rp_error($q$select public.service_return_pickup_work(0)$q$,'invalid_return_pickup_limit');

-- 8. 큐에 들어간 뒤 보류된 요청은 수거중으로 돌아올 때까지 보내지 않는다(주문 11). 아직 보내지 않은 접수는, 그 사이 운영자가 회수 방법을
--    따로 기록했으면 보내지 않고 닫는다(주문 12 — 이중 수거 방지).
select public.admin_decide_order_claim(pg_temp.rp_id('claim',n),'approve',null) from unnest(array[11,12])n;
insert into private.claim_return_pickups(bundle_id,claim_id,shipment_id,order_id,origin_id,provider,carrier,idempotency_key,next_attempt_at)
 select b.id,b.claim_id,b.shipment_id,c.order_id,pg_temp.rp_id('origin',1),'fake','hanjin','icons-return-'||replace(b.id::text,'-',''),clock_timestamp()-interval '1 minute'
 from public.order_claim_collection_bundles b join public.order_cancellation_requests c on c.id=b.claim_id where b.claim_id in(pg_temp.rp_id('claim',11),pg_temp.rp_id('claim',12));
update public.order_cancellation_requests set stage='on_hold',held_from='collecting',held_at=clock_timestamp(),hold_reason='TEST 고객 회신을 기다리는 보류' where id=pg_temp.rp_id('claim',11);
insert into private.claim_collection_plans(claim_id,shipment_id,revision,method,carrier,tracking_number,evidence,requested_once,customer_sent_once)
 values(pg_temp.rp_id('claim',12),pg_temp.rp_id('shipment',12),1,'seller_arranged','hanjin','RPMANUAL00012','TEST 운영자 접수',true,false);
select public.service_return_pickup_work(10) as held_work \gset
select pg_temp.rp_assert(not exists(select 1 from jsonb_array_elements(:'held_work'::jsonb->'items') i
  where (i->>'pickupId')::uuid in(select id from private.claim_return_pickups where claim_id in(pg_temp.rp_id('claim',11),pg_temp.rp_id('claim',12))))
 and (select state='pending' and attempts=0 and lease_token is null from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',11))
 and (select state='canceled' and cancel_reason='manual' from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',12)),
 'held requests wait and manually arranged pickups close unsent');
update public.order_cancellation_requests set stage='collecting',held_from=null,held_at=null,hold_reason=null where id=pg_temp.rp_id('claim',11);
select pg_temp.rp_assert(exists(select 1 from jsonb_array_elements(public.service_return_pickup_work(10)->'items') i
 where (i->>'pickupId')::uuid=(select id from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',11))), 'resumed request is sent');

-- 9. 요청이 나가는 사이 철회(주문 11): 접수 요청이 임대된 채 결과를 받기 전에 고객이 철회했다. 접수됐다고 알리지 않고 바로 취소로 돌린다.
update public.order_cancellation_requests set stage='withdrawn',withdrawn_at=clock_timestamp() where id=pg_temp.rp_id('claim',11);
select public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',p.lease_token,'kind','request','outcome','requested',
 'trackingNumber','RPPICK0011'))) from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',11);
select pg_temp.rp_assert((select state='cancel_pending' and cancel_reason='withdrawn' and tracking_number='RPPICK0011' and lease_token is null and next_attempt_at<=clock_timestamp()
  from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',11))
 and not exists(select 1 from public.notifications where source_id=pg_temp.rp_id('claim',11)::text and title='방문 회수가 접수됐어요')
 and exists(select 1 from private.claim_collection_events e where e.claim_id=pg_temp.rp_id('claim',11) and e.request#>>'{values,evidence}' like '자동 회수 접수 후 즉시 취소 · %')
 and exists(select 1 from public.audit_log where action='system.order.claim_return_pickup_requested' and diff->>'claimId'=pg_temp.rp_id('claim',11)::text and diff->>'canceledAtOnce'='withdrawn'),
 'a request withdrawn while in flight is canceled at once without the accepted notice');
select pg_temp.rp_assert(exists(select 1 from jsonb_array_elements(public.service_return_pickup_work(10)->'items') i where i->>'kind'='cancel' and i->>'trackingNumber'='RPPICK0011'),
 'the late-withdrawn pickup goes straight to cancellation');
-- 시간 예산이 끝나 보내지 못한 취소(deferred)는 임대를 풀고 시도 횟수를 되돌린다.
select pg_temp.rp_assert((select cancel_attempts=1 and lease_token is not null from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',11)), 'cancel was leased and counted');
select public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',p.lease_token,'kind','cancel','outcome','deferred')))
 from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',11);
select pg_temp.rp_assert((select state='cancel_pending' and cancel_attempts=0 and lease_token is null and lease_until is null from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',11)),
 'a deferred cancel releases the lease and gives the attempt back');

-- 10. 묶음 단위 안내·선물·회수 생략·시도 되돌리기. 주문 13은 김포(계약)·남양주(계약 없음) 두 배송 건, 주문 14는 선물, 주문 18·19는 회수 생략 하자 교환.
select public.admin_decide_order_claim(pg_temp.rp_id('claim',n),'approve',null) from unnest(array[13,14,18,19])n;
select pg_temp.rp_as(2);
select pg_temp.rp_assert(public.get_my_order_return_pickup(pg_temp.rp_id('order',13))='{"pickupBundles":1,"directBundles":1}'::jsonb, 'mixed origins: one visit bundle and one direct bundle');
select pg_temp.rp_as(4);
select pg_temp.rp_assert(public.get_my_order_return_pickup(pg_temp.rp_id('order',14))='{"pickupBundles":1,"directBundles":0}'::jsonb, 'gift: the recipient reads the order summary');
select pg_temp.rp_as(2);
select pg_temp.rp_assert(public.get_my_order_return_pickup(pg_temp.rp_id('order',14))='{"pickupBundles":0,"directBundles":0}'::jsonb, 'gift: the sender reads nothing');
select pg_temp.rp_as(1);
select public.service_return_pickup_work(20) as mixed_work \gset
select pg_temp.rp_assert((select count(*)=1 from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',13))
 and (select origin_id=pg_temp.rp_id('origin',1) and attempts=1 and lease_token is not null from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',13)),
 'mixed order queues only the contracted origin bundle');
-- 시간 예산이 끝나 보내지 못한 접수(deferred)는 임대를 풀고 이번 회차가 센 시도를 되돌린다. 다음 회차가 다시 잡는다.
select public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',p.lease_token,'kind','request','outcome','deferred')))
 from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',13);
select pg_temp.rp_assert((select state='pending' and attempts=0 and lease_token is null from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',13)), 'deferred request gives the attempt back');
select pg_temp.rp_assert(exists(select 1 from jsonb_array_elements(public.service_return_pickup_work(20)->'items') i
  where (i->>'pickupId')::uuid=(select id from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',13))), 'the next tick picks the deferred request up again');
select pg_temp.rp_assert((select attempts=1 and lease_token is not null from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',13)), 'and counts that attempt once');
select public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',p.lease_token,'kind','request','outcome','requested',
 'trackingNumber','RPPICK0013'))) from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',13);
select public.service_record_return_pickup_results(jsonb_build_array(jsonb_build_object('pickupId',p.id,'leaseToken',p.lease_token,'kind','request','outcome','requested',
 'trackingNumber','RPPICK0019'))) from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',19);
update private.claim_return_pickups set lease_token=null,lease_until=null,attempts=0 where claim_id=pg_temp.rp_id('claim',18);
-- 회수 생략(하자 교환): 아직 보내지 않은 접수(주문 18)는 닫고, 접수된 수거(주문 19)는 취소를 맡긴다. 안내에서도 빠진다.
insert into public.order_claim_collection_waivers(claim_id,shipment_id,order_id,reason,evidence_file_ids,waived_by,waived_at)
 select pg_temp.rp_id('claim',n),pg_temp.rp_id('shipment',n),pg_temp.rp_id('order',n),'TEST 하자 교환 회수 생략 결정 사유',array[gen_random_uuid()],pg_temp.rp_id('user',1),clock_timestamp()
 from unnest(array[18,19])n;
select public.service_return_pickup_work(20);
select pg_temp.rp_assert((select state='canceled' and cancel_reason='waived' from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',18))
 and (select state='cancel_pending' and cancel_reason='waived' from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',19))
 and not exists(select 1 from private.claim_return_pickups p where p.claim_id=pg_temp.rp_id('claim',18) and p.attempts>0),
 'waived shipments: unsent pickups close, requested pickups go to cancellation');
select pg_temp.rp_as(2);
select pg_temp.rp_assert(public.get_my_order_return_pickup(pg_temp.rp_id('order',18))='{"pickupBundles":0,"directBundles":0}'::jsonb, 'waived shipments need no sending');
select pg_temp.rp_assert(public.get_my_order_return_pickup(pg_temp.rp_id('order',13))='{"pickupBundles":1,"directBundles":1}'::jsonb, 'mixed order after the pickup is accepted');
select pg_temp.rp_as(1);

-- 11. 껐다 다시 켜기. 출고지 계약을 끈 동안 승인한 반품(주문 16)과 전체 스위치를 끈 동안 승인한 반품(주문 17)은 다시 켜도 접수하지 않는다
--     (그동안 고객이 착불 반송을 안내받았다). 다시 켠 뒤 승인한 반품(주문 20)은 접수한다.
update private.return_pickup_origins set enabled=false where origin_id=pg_temp.rp_id('origin',1);
select public.admin_decide_order_claim(pg_temp.rp_id('claim',16),'approve',null);
update private.return_pickup_origins set enabled=true where origin_id=pg_temp.rp_id('origin',1);
update private.return_pickup_settings set pickup_enabled=false where singleton;
select public.admin_decide_order_claim(pg_temp.rp_id('claim',17),'approve',null);
update private.return_pickup_settings set pickup_enabled=true where singleton;
select pg_temp.rp_assert((select origin.enabled_at>(select max(created_at) from public.order_claim_collection_bundles where claim_id=pg_temp.rp_id('claim',16))
   and settings.pickup_enabled_at>(select max(created_at) from public.order_claim_collection_bundles where claim_id=pg_temp.rp_id('claim',17))
  from private.return_pickup_origins origin cross join private.return_pickup_settings settings where origin.origin_id=pg_temp.rp_id('origin',1) and settings.singleton),
 're-enabling stamps a new enabled time');
select pg_temp.rp_assert((public.service_return_pickup_work(20)->>'queued')::integer=0, 'nothing is queued after re-enabling');
select pg_temp.rp_assert(not exists(select 1 from private.claim_return_pickups where claim_id in(pg_temp.rp_id('claim',16),pg_temp.rp_id('claim',17))),
 'bundles approved while the contract or switch was off are not queued after re-enabling');
select public.admin_decide_order_claim(pg_temp.rp_id('claim',20),'approve',null);
select pg_temp.rp_assert((public.service_return_pickup_work(20)->>'queued')::integer=1, 'bundles approved after re-enabling are queued');
select pg_temp.rp_assert(exists(select 1 from private.claim_return_pickups where claim_id=pg_temp.rp_id('claim',20)), 'and the row exists');

-- 다시 끄면 크론은 아무것도 하지 않는다(이미 남은 기록은 그대로). 고객 안내: 접수된 수거(requested)는 방문 회수로 남고, 접수 대기(pending)는 아니다.
update private.return_pickup_settings set pickup_enabled=false where singleton;
select pg_temp.rp_as(2);
select pg_temp.rp_assert(public.get_my_order_return_pickup(pg_temp.rp_id('order',13))='{"pickupBundles":1,"directBundles":1}'::jsonb, 'off: a requested pickup is still a visit pickup');
select pg_temp.rp_assert(public.get_my_order_return_pickup(pg_temp.rp_id('order',20))='{"pickupBundles":0,"directBundles":1}'::jsonb, 'off: a pending pickup is no longer announced as a visit');
select pg_temp.rp_as(4);
select pg_temp.rp_assert(public.get_my_order_return_pickup(pg_temp.rp_id('order',14))='{"pickupBundles":0,"directBundles":1}'::jsonb, 'off: a pending gift pickup is not announced either');
select pg_temp.rp_as(1);
select pg_temp.rp_assert(public.service_return_pickup_work(10)='{"enabled":false}'::jsonb and not public.get_good_return_pickup('rp-good-1')
 and public.admin_claim_return_operations()#>>'{pickup,enabled}'='false', 'switch off stops the queue');

rollback;
