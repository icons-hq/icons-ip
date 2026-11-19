\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Every amount/address/provider key is synthetic.
-- 합포장 구성 배송 건이 취소되면 그 배송 건을 묶음에서 뺀다(2026-11-16, 원장 재작업 알려진 후속 1).
-- 전에는 운영자 전액 취소가 끝나도 취소된 배송 건이 묶음에 남아, 같은 묶음의 다른 주문이
-- 단독 출고(shipment_pack_selection_required)·묶음 출고(shipment_not_ready)·해제(shipment_pack_release_blocked)
-- 모두 막혔다. 남는 구성원이 1건이면 묶음 자체를 해제한다.
begin;
-- 합성 운송장번호를 쓴다. 택배사별 번호 형식(한진·우체국)은 tracking_number_integrity.sql이 보므로 이 트랜잭션에서만 끈다.
update public.shipping_carriers set tracking_number_pattern=null,tracking_number_rule=null where tracking_number_pattern is not null;
create function pg_temp.transaction_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('bf170000-0000-4000-8000-000000000001','authenticated','authenticated','pack-cancel-admin@example.test',now(),'{}','{}',now(),now()),
 ('bf170000-0000-4000-8000-000000000002','authenticated','authenticated','pack-cancel-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 합포장 취소 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='bf170000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('bf170000-0000-4000-8000-000000000001','bf170000-0000-4000-8000-000000000002');
insert into private.operator_memberships(profile_id,manager_role) values('bf170000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.ips(id,title,vertical_key,published_at) values('pack-cancel-ip','TEST 거래 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('bf170000-0000-4000-8000-000000000010','pack-cancel-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('pack-cancel-a','pack-cancel-ip','TEST 상품 A','문구',10000,'ok',100,'bf170000-0000-4000-8000-000000000010','policy',0);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','confirmation-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='pack-cancel-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='pack-cancel-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='pack-cancel-ip';

insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select ('bf170000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('bf170000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour' from generate_series(1,2)n;
create function pg_temp.as_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','bf170000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','bf170000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','session_id','bf170000-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;
create function pg_temp.confirm_order(n integer) returns uuid language plpgsql as $$
declare oid uuid:=('bf170000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;sid uuid:=('bf170000-0000-4003-8000-'||lpad(n::text,12,'0'))::uuid;item uuid;
begin
 insert into public.orders(id,user_id,status,total,address,confirmed_at,store_credit_policy_snapshot) values(oid,'bf170000-0000-4000-8000-000000000002','confirmed',10000,
 '{"recipientName":"TEST 합포장","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',now()-interval '1 hour',
 '{"enabled":true,"earnKind":"fixed","earnValue":100,"earnMaxPerOrder":1000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":1000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits"}');
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select oid,g.id,v.id,1,10000,g.name,g.type,g.ip_id from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='pack-cancel-a' returning id into item;
 insert into public.payments(user_id,purpose,ref_id,provider,amount,status,payment_key,idempotency_key) values('bf170000-0000-4000-8000-000000000002','order',oid,'toss',10000,'paid','pk_pack_cancel_'||n,'pack-cancel-payment-'||n);
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
 values(sid,oid,'bf170000-0000-4000-8000-000000000010','TEST 출고지',0,'{}');
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
 return oid;
end $$;
select pg_temp.confirm_order(n) from generate_series(1,7)n;
-- 운영자 전액 취소를 실제 경로(시작 RPC → 서버의 결제사 확인 뒤 완료 RPC → finalizer)로 끝낸다.
create function pg_temp.staff_cancel(n integer,warehouse_stop boolean) returns uuid language plpgsql as $$
declare request uuid;begin
 perform pg_temp.as_actor(1);
 execute 'set local role authenticated';
 request:=public.admin_start_order_cancellation(('bf170000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,'customer_request','TEST 합포장 구성 주문 취소',warehouse_stop);
 execute 'set local role service_role';
 perform public.complete_order_cancellation_request(request,array['pk_pack_cancel_'||n],'bf170000-0000-4000-8000-000000000001');
 execute 'reset role';
 return request;
end $$;
create function pg_temp.sid(n integer) returns uuid language sql as $$select ('bf170000-0000-4003-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.pack(n integer) returns uuid language sql as $$select private.shipment_pack_id(pg_temp.sid(n))$$;
create function pg_temp.make_pack(ids uuid[],operation uuid) returns uuid language plpgsql as $$
declare preview jsonb;begin
 perform pg_temp.as_actor(1);
 execute 'set local role authenticated';
 preview:=public.admin_get_shipment_packs(ids);
 if preview->>'canCreate'<>'true' then raise exception 'pack fixture not creatable: %',preview;end if;
 perform public.admin_change_shipment_pack(ids,'create',preview->>'version','TEST 같은 받는 분 확인',operation,'bf170000-0000-4000-8000-000000000001','bf170000-0000-4000-9000-000000000001');
 execute 'reset role';
 return operation;
end $$;

-- ---------------------------------------------------------------------------
-- A: 출고지시 전 3건 묶음에서 한 주문을 운영자 전액 취소 → 그 배송 건만 빠지고 2건 묶음은 유지된다.
-- ---------------------------------------------------------------------------
select pg_temp.make_pack(array[pg_temp.sid(1),pg_temp.sid(2),pg_temp.sid(3)],'bf170000-0000-4002-8000-000000000001') as pack_a \gset
select pg_temp.staff_cancel(3,false) as request_a \gset
select 1/case when (select status='canceled' from public.orders where id='bf170000-0000-4001-8000-000000000003')
 and (select status='canceled' from public.order_shipments where id=pg_temp.sid(3)) then 1 else 0 end as staff_cancellation_completed;
select 1/case when pg_temp.pack(3) is null
 and pg_temp.pack(1)=:'pack_a'::uuid and pg_temp.pack(2)=:'pack_a'::uuid
 and (select released_at is null and revision=2 from private.shipment_packs where id=:'pack_a') then 1 else 0 end as canceled_member_leaves_the_pack;
select 1/case when (select released_at is not null from private.shipment_pack_members where pack_id=:'pack_a' and shipment_id=pg_temp.sid(3))
 then 1 else 0 end as membership_history_is_kept;
select 1/case when (select count(*)=1 and bool_and(a.diff->>'packId'=:'pack_a' and a.diff->>'shipmentId'=pg_temp.sid(3)::text
 and (a.diff->>'dissolved')::boolean=false and a.diff->'remainingShipmentIds'=jsonb_build_array(pg_temp.sid(1),pg_temp.sid(2))
 and a.diff->>'orderId'='bf170000-0000-4001-8000-000000000003')
 from public.audit_log a where a.action='system.shipment.pack_member_canceled' and a.target=:'pack_a') then 1 else 0 end as removal_is_audited;
select pg_temp.as_actor(1);
set local role authenticated;
-- 남은 2건은 여전히 한 상자다: 한 건만 고르면 막히고, 둘을 고르면 출고지시·해제가 열린다.
select pg_temp.transaction_expect_error(format('select public.admin_shipment_export(array[%L::uuid])',pg_temp.sid(1)),'shipment_pack_selection_required');
select public.admin_shipment_export(array[pg_temp.sid(1),pg_temp.sid(2)]) as export_a \gset
select 1/case when jsonb_array_length(:'export_a'::jsonb->'shipments')=2 and :'export_a'::jsonb#>>'{shipments,0,pack,count}'='2' then 1 else 0 end as remaining_pair_exports_whole;
select public.admin_get_shipment_packs(array[pg_temp.sid(1)]) as packed_a \gset
select 1/case when :'packed_a'::jsonb#>>'{rows,0,pack,canRelease}'='true' then 1 else 0 end as remaining_pair_can_release;
select public.admin_change_shipment_pack(array[pg_temp.sid(1)],'release',:'packed_a'::jsonb->>'version','TEST 남은 묶음 해제','bf170000-0000-4002-8000-000000000011','bf170000-0000-4000-8000-000000000001','bf170000-0000-4000-9000-000000000001');
reset role;
select 1/case when pg_temp.pack(1) is null and pg_temp.pack(2) is null then 1 else 0 end as remaining_pair_released;

-- ---------------------------------------------------------------------------
-- B: 출고지시가 나간 2건 묶음에서 한 주문을 창고 출고 중단 확인과 함께 취소 → 묶음이 풀리고 남은 주문은 단독 송장으로 출고된다.
-- ---------------------------------------------------------------------------
select pg_temp.make_pack(array[pg_temp.sid(4),pg_temp.sid(5)],'bf170000-0000-4002-8000-000000000002') as pack_b \gset
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_shipment_export(array[pg_temp.sid(4),pg_temp.sid(5)]) as export_b \gset
select public.admin_mark_shipments_exported((select jsonb_agg(jsonb_build_object('id',value->'id','updatedAt',value->'updatedAt')) from jsonb_array_elements(:'export_b'::jsonb->'shipments')));
reset role;
select pg_temp.transaction_expect_error('select pg_temp.staff_cancel(5,false)','warehouse_stop_reply_required');
reset role;
-- 확인란만으로는 열리지 않는다. 그 배송 건의 출고지시 뒤 창고 '출고 중단' 회신 기록이 근거다(ADR-0046).
select pg_temp.transaction_expect_error('select pg_temp.staff_cancel(5,true)','warehouse_stop_reply_required');
reset role;
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_record_warehouse_stop_reply(array[pg_temp.sid(5)],'stopped','phone',clock_timestamp(),'TEST 창고 통화 출고 중단 확인','bf170000-0000-4002-8000-0000000000b5');
reset role;
select pg_temp.staff_cancel(5,true) as request_b \gset
select 1/case when pg_temp.pack(4) is null and pg_temp.pack(5) is null
 and (select released_at is not null and release_reason='구성 배송 건 취소로 자동 해제' and revision=2 from private.shipment_packs where id=:'pack_b')
 and (select count(*)=2 and bool_and(released_at is not null) from private.shipment_pack_members where pack_id=:'pack_b') then 1 else 0 end as last_pair_dissolves;
select 1/case when (select count(*)=1 and bool_and((a.diff->>'dissolved')::boolean and a.diff->'remainingShipmentIds'=jsonb_build_array(pg_temp.sid(4)))
 from public.audit_log a where a.action='system.shipment.pack_member_canceled' and a.target=:'pack_b') then 1 else 0 end as dissolution_is_audited;
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_import_shipment_tracking_batch(jsonb_build_array(jsonb_build_object('line',1,'reference',pg_temp.sid(4),'carrier','hanjin','trackingNumber','TESTPACKCANCEL4'))) as imported_b \gset
reset role;
select 1/case when (select status='shipping' and tracking_number='TESTPACKCANCEL4' from public.order_shipments where id=pg_temp.sid(4))
 and (select status='canceled' and tracking_number is null from public.order_shipments where id=pg_temp.sid(5)) then 1 else 0 end as remaining_order_ships_alone;

-- ---------------------------------------------------------------------------
-- C: 이 수정 전에 이미 취소된 구성원이 남은 묶음은 migration의 정리 함수가 같은 규칙으로 푼다(멱등).
-- ---------------------------------------------------------------------------
select pg_temp.make_pack(array[pg_temp.sid(6),pg_temp.sid(7)],'bf170000-0000-4002-8000-000000000003') as pack_c \gset
-- 수정 전 상태 재현: 트리거 없이 배송 건만 취소된 채 묶음에 남는다.
set local session_replication_role = replica;
update public.order_shipments set status='canceled',updated_at=clock_timestamp() where id=pg_temp.sid(7);
set local session_replication_role = origin;
select 1/case when pg_temp.pack(7)=:'pack_c'::uuid then 1 else 0 end as stale_member_fixture;
select 1/case when private.release_canceled_shipment_pack_members()=1 and private.release_canceled_shipment_pack_members()=0 then 1 else 0 end as repair_is_idempotent;
select 1/case when pg_temp.pack(6) is null and pg_temp.pack(7) is null
 and (select released_at is not null from private.shipment_packs where id=:'pack_c') then 1 else 0 end as stale_pack_repaired;

select 1/case when not has_function_privilege('authenticated','private.release_canceled_shipment_pack_members()','execute')
 and not has_function_privilege('service_role','private.release_canceled_shipment_pack_members()','execute')
 and not has_function_privilege('authenticated','private.release_canceled_shipment_pack_member()','execute') then 1 else 0 end as sealed_acl;
rollback;
