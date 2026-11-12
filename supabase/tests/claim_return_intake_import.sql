\set ON_ERROR_STOP on
-- 반품입고 파일 반영(QNA-034·ADR-0034)의 DB 계약.
-- 1. 스위치를 켠 적이 없으면 미리보기·확정을 거절하고 운영 요약은 꺼짐뿐이다. 켜려면 근거·시각이 필요하고, 열 이름 대응표는 한 머리글이
--    두 칸에 대응하지 않아야 한다.
-- 2. 매칭: 회수 송장(자동 회수 접수·운영자 수거 송장) → 아니면 주문번호 + 연락처 끝 8자리. 아직 입고되지 않은 회수 묶음이 정확히
--    하나일 때만 맞추고, 반품지가 갈린 배송 건은 '여러 곳', 주문번호만 있으면 '연락처 필요', 날짜 형식·미래·주문일 이전은 거절, 한 파일 안의
--    같은 묶음은 '중복'이다. 응답에 연락처·주소를 싣지 않는다.
-- 3. 확정은 회수 묶음마다 T11b·T14a 회수 확인 경로로 기록한다(실제 입고일 = 파일 날짜, 근거 = 파일 SHA-256·행 번호, 처리자 = 운영자).
--    미리보기와 달라진 줄은 기록하지 않는다. 같은 operation 재전송은 같은 결과, 다른 요청이면 충돌. 다시 올린 같은 파일은 '이미 입고'다.
-- 합성 데이터만 쓰고 롤백한다.
begin;
load 'safeupdate';
create function pg_temp.ri_id(kind text,n integer) returns uuid language sql immutable as $$select md5('claim-return-intake:'||kind||':'||n)::uuid$$;
create function pg_temp.ri_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'return-intake assertion: %',label;end if;end$$;
create function pg_temp.ri_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected return-intake rejection: %',expected;end$$;
create function pg_temp.ri_today() returns date language sql stable as $$select (clock_timestamp() at time zone 'Asia/Seoul')::date$$;
create function pg_temp.ri_as(n integer) returns void language sql as $$
 select set_config('request.jwt.claim.sub',pg_temp.ri_id('user',n)::text,true);
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ri_id('user',n),'role','authenticated','session_id',pg_temp.ri_id('session',n))::text,true);
$$;

select pg_temp.ri_assert(
 has_function_privilege('authenticated','public.admin_preview_claim_return_intake(jsonb)','execute')
 and not has_function_privilege('anon','public.admin_preview_claim_return_intake(jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_preview_claim_return_intake(jsonb)','execute')
 and has_function_privilege('authenticated','public.admin_confirm_claim_return_intake(jsonb,text,uuid)','execute')
 and not has_function_privilege('anon','public.admin_confirm_claim_return_intake(jsonb,text,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_confirm_claim_return_intake(jsonb,text,uuid)','execute')
 and not has_function_privilege('authenticated','private.claim_return_intake_match(jsonb)','execute')
 and not has_function_privilege('service_role','private.claim_return_intake_match(jsonb)','execute')
 and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='claim_return_intake_imports'
  and c.relrowsecurity and not has_table_privilege('authenticated',c.oid,'select') and not has_table_privilege('service_role',c.oid,'select'))
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_preview_claim_return_intake(jsonb)' and capability='sales.manage' and guard_kind='read')
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_confirm_claim_return_intake(jsonb,text,uuid)' and capability='sales.manage' and guard_kind='write'),
 'entry points are operator-only and classified');

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.ri_id('user',n),'authenticated','authenticated','claim-return-intake-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set nickname='TEST 반품입고 '||right(id::text,6),
 role=case when id=pg_temp.ri_id('user',2) then 'user'::public.user_role else 'admin'::public.user_role end
 where id in(select pg_temp.ri_id('user',n) from generate_series(1,3)n);
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.ri_id('user',3),'owner' where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.ri_id('user',1),'primary');
update private.operator_access_state set configured=true where id;

insert into public.ips(id,title,vertical_key) values('ri-ip','TEST 반품입고','character');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values
 (pg_temp.ri_id('origin',1),'ri-namyangju','TEST 남양주','epost',0,'TEST 남양주 반송지',true);
insert into public.return_addresses(id,name,address,phone) values(pg_temp.ri_id('place',1),'TEST 서울 반품지','TEST 서울 반품지 주소','0212345678');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
 ('ri-good-1','ri-ip','TEST 남양주 굿즈','문구',1000,'ok',50,pg_temp.ri_id('origin',1)),
 ('ri-good-2','ri-ip','TEST 서울 반품 굿즈','문구',1000,'ok',50,pg_temp.ri_id('origin',1));
update public.goods set return_address_id=pg_temp.ri_id('place',1) where id='ri-good-2';
create function pg_temp.ri_default(good text) returns uuid language sql stable as $$select id from public.goods_variants where good_id=good and is_default$$;

-- 주문 1: 자동 회수 접수 송장. 주문 2: 운영자가 기록한 수거 송장. 주문 3: 주문번호 + 연락처. 주문 4: 반품지가 갈린 배송 건(굿즈 2개).
-- 주문 5: 승인 전 반품(묶음 없음). 모든 주문은 닷새 전에 만들었다.
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at,created_at)
 select pg_temp.ri_id('order',n),pg_temp.ri_id('user',2),'delivered',5000,0,
  jsonb_build_object('recipientName','합성 반품 고객 '||n,'phone','010-7777-'||lpad(n::text,4,'0'),'postalCode','12345','address1','합성시 입고로 '||n,'address2','20'||n||'호'),
  now()-interval '4 days',now()-interval '3 days',now()-interval '5 days' from generate_series(1,5)n;
create function pg_temp.ri_number(n integer) returns text language sql stable as $$select order_number from public.orders where id=pg_temp.ri_id('order',n)$$;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.ri_id('item',n),pg_temp.ri_id('order',n),'ri-good-1',pg_temp.ri_default('ri-good-1'),1,1000,'TEST 반품 굿즈 '||n,'문구','ri-ip' from generate_series(1,5)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 values(pg_temp.ri_id('item',40),pg_temp.ri_id('order',4),'ri-good-2',pg_temp.ri_default('ri-good-2'),2,1000,'TEST 서울 반품 굿즈','문구','ri-ip');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at)
 select pg_temp.ri_id('shipment',n),pg_temp.ri_id('order',n),pg_temp.ri_id('origin',1),'TEST 남양주',0,'{}','delivered','epost','RISALE'||lpad(n::text,6,'0'),now()-interval '4 days',now()-interval '3 days'
 from generate_series(1,5)n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) select pg_temp.ri_id('order',n),pg_temp.ri_id('shipment',n),pg_temp.ri_id('item',n),1 from generate_series(1,5)n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(pg_temp.ri_id('order',4),pg_temp.ri_id('shipment',4),pg_temp.ri_id('item',40),2);
insert into public.payments(id,user_id,purpose,ref_id,amount,status,idempotency_key,provider)
 select pg_temp.ri_id('payment',n),pg_temp.ri_id('user',2),'order',pg_temp.ri_id('order',n),5000,'paid','ri-pay-'||n,'toss' from generate_series(1,5)n;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type)
 select pg_temp.ri_id('claim',n),pg_temp.ri_id('order',n),pg_temp.ri_id('user',2),'TEST 반품입고 '||n,case when n=2 then 'exchange' else 'return' end,'requested','change_of_mind' from generate_series(1,5)n;

select set_config('request.jwt.claim.role','service_role',true);
select pg_temp.ri_as(1);
select public.admin_decide_order_claim(pg_temp.ri_id('claim',n),'approve',null) from generate_series(1,4)n;
select pg_temp.ri_assert((select count(*)=2 from public.order_claim_collection_bundles where claim_id=pg_temp.ri_id('claim',4)), 'order 4 splits into two bundles');
-- 주문 1의 회수 묶음에는 자동 회수 접수 송장이, 주문 2에는 운영자가 기록한 수거 송장이 있다.
insert into private.claim_return_pickups(bundle_id,claim_id,shipment_id,order_id,origin_id,provider,carrier,idempotency_key,state,attempts,tracking_number,requested_at)
 select b.id,b.claim_id,b.shipment_id,pg_temp.ri_id('order',1),pg_temp.ri_id('origin',1),'fake','epost','icons-return-'||replace(b.id::text,'-',''),'requested',1,'RIPICK0001',clock_timestamp()
 from public.order_claim_collection_bundles b where b.claim_id=pg_temp.ri_id('claim',1);
insert into private.claim_collection_plans(claim_id,shipment_id,revision,method,carrier,tracking_number,evidence,requested_once,customer_sent_once)
 values(pg_temp.ri_id('claim',2),pg_temp.ri_id('shipment',2),1,'customer_sent','epost','RIPLAN0002','TEST 고객 발송',true,true);

create temp table ri_rows as select jsonb_build_array(
 jsonb_build_object('rowNumber',2,'trackingNumber','ripick-0001','orderNumber',null,'phone',null,'receivedOn',(pg_temp.ri_today()-1)::text),
 jsonb_build_object('rowNumber',3,'trackingNumber','RIPLAN0002','orderNumber','','phone','','receivedOn',(pg_temp.ri_today()-2)::text),
 jsonb_build_object('rowNumber',4,'trackingNumber',null,'orderNumber',regexp_replace(pg_temp.ri_number(3),'^([0-9]{4})([0-9]{4})([0-9]{4})','\1-\2-\3-'),'phone','010 7777 0003','receivedOn',pg_temp.ri_today()::text),
 jsonb_build_object('rowNumber',5,'trackingNumber','UNKNOWN99999','orderNumber',null,'phone',null,'receivedOn',pg_temp.ri_today()::text),
 jsonb_build_object('rowNumber',6,'trackingNumber',null,'orderNumber',pg_temp.ri_number(4),'phone','01077770004','receivedOn',pg_temp.ri_today()::text),
 jsonb_build_object('rowNumber',7,'trackingNumber',null,'orderNumber',pg_temp.ri_number(3),'phone',null,'receivedOn',pg_temp.ri_today()::text),
 jsonb_build_object('rowNumber',8,'trackingNumber','RIPICK0001','orderNumber',null,'phone',null,'receivedOn',pg_temp.ri_today()::text),
 jsonb_build_object('rowNumber',9,'trackingNumber','RIPLAN0002','orderNumber',null,'phone',null,'receivedOn','2026-02-30'),
 jsonb_build_object('rowNumber',10,'trackingNumber','RIPLAN0002','orderNumber',null,'phone',null,'receivedOn',(pg_temp.ri_today()+1)::text),
 jsonb_build_object('rowNumber',11,'trackingNumber','RIPLAN0002','orderNumber',null,'phone',null,'receivedOn',(pg_temp.ri_today()-30)::text),
 jsonb_build_object('rowNumber',12,'trackingNumber',null,'orderNumber',pg_temp.ri_number(4),'phone','01099990004','receivedOn',pg_temp.ri_today()::text)) value;

-- 1. 꺼진 상태: 미리보기·확정 모두 거절한다.
select pg_temp.ri_error(format('select public.admin_preview_claim_return_intake(%L::jsonb)',(select value from ri_rows)),'claim_return_intake_disabled');
select pg_temp.ri_error(format('select public.admin_confirm_claim_return_intake(%L::jsonb,%L,%L)','[{"rowNumber":2,"bundleId":null}]',repeat('a',64),gen_random_uuid()),'claim_return_intake_disabled');
select pg_temp.ri_assert(public.admin_claim_return_operations()->'intake'='{"enabled":false}'::jsonb, 'off: no intake panel');
select pg_temp.ri_error($q$update private.return_pickup_settings set intake_enabled=true where singleton$q$,'23514');
update private.return_pickup_settings set intake_enabled=true,intake_evidence='TEST 서원 반품입고 양식 시험',intake_enabled_at=clock_timestamp() where singleton;
select pg_temp.ri_assert(public.admin_claim_return_operations()#>'{intake,columns,receivedOn}' ? '입고일', 'on: column map is handed to the app');

-- 2. 미리보기(쓰기 없음).
select public.admin_preview_claim_return_intake((select value from ri_rows)) as preview \gset
create temp table ri_preview as select value from jsonb_array_elements(:'preview'::jsonb->'rows');
create function pg_temp.ri_row(n integer) returns jsonb language sql stable as $$select value from ri_preview where (value->>'rowNumber')::integer=n$$;
select pg_temp.ri_assert(pg_temp.ri_row(2)->>'status'='matched' and pg_temp.ri_row(2)->>'matchedBy'='tracking' and pg_temp.ri_row(2)->>'trackingNumber'='RIPICK0001'
 and pg_temp.ri_row(2)->>'claimId'=pg_temp.ri_id('claim',1)::text and pg_temp.ri_row(2)->>'receivedOn'=(pg_temp.ri_today()-1)::text, 'pickup tracking matches');
select pg_temp.ri_assert(pg_temp.ri_row(3)->>'status'='matched' and pg_temp.ri_row(3)->>'claimId'=pg_temp.ri_id('claim',2)::text, 'operator tracking matches');
select pg_temp.ri_assert(pg_temp.ri_row(4)->>'status'='matched' and pg_temp.ri_row(4)->>'matchedBy'='order_phone' and pg_temp.ri_row(4)->>'orderNumber'=pg_temp.ri_number(3),
 'order number with phone matches');
select pg_temp.ri_assert(pg_temp.ri_row(5)->>'status'='not_found' and not (pg_temp.ri_row(5) ? 'claimId'), 'unknown tracking is not found');
select pg_temp.ri_assert(pg_temp.ri_row(6)->>'status'='ambiguous' and pg_temp.ri_row(6)->>'claimId'=pg_temp.ri_id('claim',4)::text, 'split bundles are ambiguous');
select pg_temp.ri_assert(pg_temp.ri_row(7)->>'status'='phone_required', 'order number alone is not enough');
select pg_temp.ri_assert(pg_temp.ri_row(8)->>'status'='duplicate', 'second row for the same bundle is a duplicate');
select pg_temp.ri_assert(pg_temp.ri_row(9)->>'status'='received_on_invalid' and pg_temp.ri_row(10)->>'status'='received_on_future'
 and pg_temp.ri_row(11)->>'status'='received_on_before_order', 'dates are validated');
select pg_temp.ri_assert(pg_temp.ri_row(12)->>'status'='not_found', 'wrong phone does not match');
select pg_temp.ri_assert((:'preview'::jsonb#>>'{counts,matched}')::integer=3 and (:'preview'::jsonb#>>'{counts,not_found}')::integer=2
 and :'preview'::text not like '%7777%' and :'preview'::text not like '%합성%' and :'preview'::text not like '%반송지%'
 and not exists(select 1 from public.order_claim_collection_bundles where claim_id in(pg_temp.ri_id('claim',1),pg_temp.ri_id('claim',2),pg_temp.ri_id('claim',3)) and collected_at is not null),
 'preview counts rows, carries no personal data, and changes nothing');
select pg_temp.ri_error($q$select public.admin_preview_claim_return_intake('[{"rowNumber":1,"phone":1}]'::jsonb)$q$,'invalid_return_intake_rows');
select pg_temp.ri_error($q$select public.admin_preview_claim_return_intake('[{"rowNumber":1,"name":"x"}]'::jsonb)$q$,'invalid_return_intake_rows');
select pg_temp.ri_error($q$select public.admin_preview_claim_return_intake('[{"rowNumber":1},{"rowNumber":1}]'::jsonb)$q$,'invalid_return_intake_rows');
select pg_temp.ri_error($q$select public.admin_preview_claim_return_intake('[]'::jsonb)$q$,'invalid_return_intake_rows');
-- 고객은 부를 수 없다.
select pg_temp.ri_as(2);
select pg_temp.ri_error(format('select public.admin_preview_claim_return_intake(%L::jsonb)',(select value from ri_rows)),'42501');
select pg_temp.ri_as(1);

-- 3. 확정: 맞춘 세 줄을 묶음과 함께 보낸다. 4행은 미리보기와 다른 묶음을 보내 '달라짐'이 된다(기록하지 않음).
create temp table ri_confirm as select jsonb_agg(r.value || jsonb_build_object('bundleId',
  case when (p.value->>'rowNumber')::integer=4 then to_jsonb(pg_temp.ri_id('claim',99)) when p.value->>'status'='matched' then p.value->'bundleId' else 'null'::jsonb end)
  order by (r.value->>'rowNumber')::integer) value
 from jsonb_array_elements((select value from ri_rows)) r join ri_preview p on (p.value->>'rowNumber')=(r.value->>'rowNumber');
select public.admin_confirm_claim_return_intake((select value from ri_confirm),repeat('c',64),pg_temp.ri_id('operation',1)) as confirmed \gset
select pg_temp.ri_assert((:'confirmed'::jsonb->>'recorded')::integer=2 and (:'confirmed'::jsonb->>'changed')::integer=1 and (:'confirmed'::jsonb->>'skipped')::integer=8
 and (select value->>'outcome'='changed' from jsonb_array_elements(:'confirmed'::jsonb->'rows') where (value->>'rowNumber')::integer=4), 'changed rows are not recorded');
select pg_temp.ri_assert((select received_on=pg_temp.ri_today()-1 and collected_by=pg_temp.ri_id('user',1)
  and evidence='반품입고 회신 파일 SHA-256 '||repeat('c',64)||' · 2행' from public.order_claim_collection_bundles where claim_id=pg_temp.ri_id('claim',1))
 and (select received_on=pg_temp.ri_today()-2 and evidence like '% · 3행' from public.order_claim_collection_bundles where claim_id=pg_temp.ri_id('claim',2))
 and (select stage='collected' and collection_received_on=pg_temp.ri_today()-1 from public.order_cancellation_requests where id=pg_temp.ri_id('claim',1))
 and (select stage='collected' from public.order_cancellation_requests where id=pg_temp.ri_id('claim',2))
 and (select stage='collecting' from public.order_cancellation_requests where id=pg_temp.ri_id('claim',3)),
 'matched rows are recorded through the collection path with the file date and file evidence');
select pg_temp.ri_assert(exists(select 1 from public.audit_log where action='admin.order.claim_return_intake_confirmed' and actor_id=pg_temp.ri_id('user',1)
  and diff->>'fileSha256'=repeat('c',64) and (diff->>'recorded')::integer=2 and diff::text not like '%7777%')
 and (select count(*)=2 from public.audit_log where action='admin.order.claim_origin_collected' and diff->>'evidence' like '반품입고 회신 파일 SHA-256 cccc%'),
 'confirmation is audited without personal data');
-- 같은 operation 재전송은 같은 결과, 다른 요청이면 충돌.
select pg_temp.ri_assert((public.admin_confirm_claim_return_intake((select value from ri_confirm),repeat('c',64),pg_temp.ri_id('operation',1))->>'replayed')::boolean,
 'same operation replays the stored result');
select pg_temp.ri_error(format('select public.admin_confirm_claim_return_intake(%L::jsonb,%L,%L)',(select value from ri_confirm),repeat('d',64),pg_temp.ri_id('operation',1)),'PT409');
-- 4행을 새 operation으로 다시 확정한다(주문 3이 입고완료). 같은 파일을 다시 올리면 이미 입고된 줄은 '이미 입고'다.
select public.admin_confirm_claim_return_intake(jsonb_build_array((select value from ri_rows)->2 || jsonb_build_object('bundleId',pg_temp.ri_row(4)->'bundleId')),
 repeat('c',64),pg_temp.ri_id('operation',2)) as third \gset
select pg_temp.ri_assert((:'third'::jsonb->>'recorded')::integer=1 and (select stage='collected' from public.order_cancellation_requests where id=pg_temp.ri_id('claim',3)),
 'third matched row recorded');
select public.admin_preview_claim_return_intake((select value from ri_rows)) as again \gset
select pg_temp.ri_assert((select count(*)=5 from jsonb_array_elements(:'again'::jsonb->'rows') where value->>'status'='already_collected'), 'reuploaded rows are already collected');
-- 이미 입고된 묶음을 다른 날짜로 확정하려 해도 바꾸지 않는다(회수 확인 경로의 충돌).
select public.admin_confirm_claim_return_intake(jsonb_build_array(jsonb_build_object('rowNumber',2,'trackingNumber','RIPICK0001','orderNumber',null,'phone',null,
 'receivedOn',pg_temp.ri_today()::text,'bundleId',pg_temp.ri_row(2)->'bundleId')),repeat('e',64),pg_temp.ri_id('operation',3)) as overwrite \gset
select pg_temp.ri_assert((:'overwrite'::jsonb->>'changed')::integer=1,'already collected bundle is reported as changed');
select pg_temp.ri_assert((select received_on=pg_temp.ri_today()-1 from public.order_claim_collection_bundles where claim_id=pg_temp.ri_id('claim',1)), 'recorded intake is not overwritten');

-- 확정 입력 형식: bundleId 키가 없거나 SHA-256 형식이 틀리면 거절한다.
select pg_temp.ri_error(format('select public.admin_confirm_claim_return_intake(%L::jsonb,%L,%L)','[{"rowNumber":2}]',repeat('a',64),gen_random_uuid()),'invalid_return_intake_rows');
select pg_temp.ri_error(format('select public.admin_confirm_claim_return_intake(%L::jsonb,%L,%L)','[{"rowNumber":2,"bundleId":null}]','ABC',gen_random_uuid()),'invalid_return_intake_rows');

rollback;
