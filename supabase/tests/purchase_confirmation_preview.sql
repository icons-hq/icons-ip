\set ON_ERROR_STOP on
-- 자동 거래확정 켜기 전 미리 읽기(admin_preview_purchase_confirmation_auto)와 정책 저장의 근거·확인 체크 필수 해제.
-- 보는 것:
--   1. 조회가 아무것도 쓰지 않는다(조회 전후 주문·기한·이력·적립금·감사 기록의 행 수와 합계가 같다).
--   2. 조회가 말한 건수·적립금 합계가 실제로 켜서 저장한 뒤 자동 처리(settle_delivered_orders)가 확정·지급한 값과 같다.
--      쌓인 주문이 자동 처리 한 번의 한도(1,000건)를 넘어도 조회는 다음 실행분만 세고, 그 값이 첫 실행 결과와 같다.
--   3. 정책 저장은 근거·확인 체크 없이 되고, 저장돼 있던 근거는 그대로 남으며, 옛 화면처럼 둘 다 보내는 저장도 된다.
--   4. 권한(sales.manage)·실행 권한 봉인·운영자 계약 등록.
-- 준비물은 모두 합성 값이고 rollback된다. goods_kc_fixture.sql은 필요 없다(주문을 직접 넣는다).
begin;
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
select set_config('request.jwt.claim.sub','',true);
-- 1: 주문 관리 권한이 있는 운영자, 2: 출고 전용 운영자(sales.manage 없음), 3: 운영자가 아닌 회원,
-- 4~7: 구매자(4 일반, 5 보유 한도·만료, 6 갚을 적립금, 7 이용 정지). 8~12: 한도를 넘는 경우에 쓰는 구매자.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('c0f1a000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','confirm-preview-'||n||'@example.test',now(),'{}','{}',now(),now()
 from generate_series(1,12) n;
update public.profiles set nickname='TEST 거래확정 미리보기 '||right(id::text,2),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when right(id::text,2) in('01','02') then 'staff'::public.user_role else 'user'::public.user_role end
 where id::text like 'c0f1a000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values
 ('c0f1a000-0000-4000-8000-000000000001','primary'),('c0f1a000-0000-4000-8000-000000000002','logistics');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
 values('c0f1a000-0000-4000-9000-000000000001','c0f1a000-0000-4000-8000-000000000001',now(),now(),now()+interval '1 hour');
create function pg_temp.as_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','c0f1a000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','c0f1a000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','session_id','c0f1a000-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;
insert into public.ips(id,title,vertical_key,published_at) values('confirm-preview-ip','TEST 거래확정 미리보기 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('c0f1a000-0000-4000-8000-000000000010','confirm-preview-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,price,stock,stock_qty,origin_id) values
 ('confirm-preview-good','confirm-preview-ip','TEST 미리보기 상품',10000,'ok',1000,'c0f1a000-0000-4000-8000-000000000010');

-- 배송완료 주문 하나를 만든다. 자동 거래확정이 꺼진 채 배송완료되므로 기한 없는 확정 행이 생긴다.
create function pg_temp.delivered_order(n integer,buyer integer,delivered_days integer,order_total bigint,fee bigint,credit_policy jsonb,paid boolean default true) returns uuid language plpgsql as $$
declare oid uuid:=('c0f1a000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;sid uuid:=gen_random_uuid();item uuid;
 buyer_id uuid:=('c0f1a000-0000-4000-8000-'||lpad(buyer::text,12,'0'))::uuid;at_value timestamptz:=clock_timestamp()-make_interval(days=>delivered_days);
begin
 insert into public.orders(id,user_id,status,total,shipping_fee,address,store_credit_policy_snapshot) values(oid,buyer_id,'confirmed',order_total,fee,
  '{"recipientName":"TEST 미리보기","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',credit_policy);
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_ip_id_snapshot)
  select oid,g.id,v.id,1,order_total-fee,g.name,g.ip_id from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='confirm-preview-good' returning id into item;
 if paid then insert into public.payments(user_id,purpose,ref_id,provider,amount,status,idempotency_key) values(buyer_id,'order',oid,'toss',order_total,'paid','confirm-preview-payment-'||n);end if;
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot) values(sid,oid,'c0f1a000-0000-4000-8000-000000000010','TEST 출고지',fee,'{}');
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
 update public.order_shipments set status='delivered',carrier='hanjin',tracking_number='TESTPREVIEW'||n,shipped_at=at_value-interval '1 day',delivered_at=at_value where id=sid;
 update public.orders set status='delivered',delivered_at=at_value where id=oid;
 return oid;
end $$;
create function pg_temp.credit_policy(kind text,earn bigint,per_order bigint,max_balance bigint) returns jsonb language sql as $$
 select jsonb_build_object('enabled',true,'earnKind',kind,'earnValue',earn,'earnMaxPerOrder',per_order,'maxBalance',max_balance,'validityDays',30,
  'minUse',100,'maxUse',1000,'restoreGraceDays',3,'refundEarnedCreditMode','offset_future_credits');
$$;
-- 조회가 건드리면 안 되는 것들의 지문.
create function pg_temp.state_fingerprint() returns jsonb language sql as $$
 select jsonb_build_object(
  'orders',(select jsonb_build_array(count(*),count(*) filter(where status='done'),coalesce(sum(extract(epoch from updated_at)),0)) from public.orders),
  'confirmations',(select jsonb_build_array(count(*),coalesce(sum(revision),0),count(auto_due_at),count(confirmed_at)) from private.order_purchase_confirmations),
  'events',(select count(*) from private.purchase_confirmation_events),
  'lots',(select jsonb_build_array(count(*),coalesce(sum(available_amount),0),coalesce(sum(expired_amount),0),coalesce(sum(debt_amount),0)) from private.store_credit_lots),
  'ledger',(select count(*) from public.store_credit_ledger),
  'audit',(select count(*) from public.audit_log),
  'notifications',(select count(*) from public.notifications),
  'policy',(select to_jsonb(p) from private.purchase_confirmation_policy p where singleton));
$$;

-- 1. 실행 권한: authenticated만. anon·service_role은 실행할 수 없다. 조회는 STABLE이라 쓰는 문장을 실행할 수 없다.
select 1/case when has_function_privilege('authenticated','public.admin_preview_purchase_confirmation_auto(integer)','execute')
 and not has_function_privilege('anon','public.admin_preview_purchase_confirmation_auto(integer)','execute')
 and not has_function_privilege('service_role','public.admin_preview_purchase_confirmation_auto(integer)','execute')
 and (select provolatile='s' and prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid='public.admin_preview_purchase_confirmation_auto(integer)'::regprocedure)
 and has_function_privilege('authenticated','public.admin_save_purchase_confirmation_policy(jsonb,bigint,uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.admin_save_purchase_confirmation_policy(jsonb,bigint,uuid,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_save_purchase_confirmation_policy(jsonb,bigint,uuid,uuid,uuid)','execute')
 then 1 else 0 end as assert_sealed_and_read_only;
-- 2. 운영자 계약: 정책 화면과 같은 권한(sales.manage). 조회는 읽기, 저장은 쓰기이고 본문 지문이 지금 함수와 같다.
select 1/case when (select count(*)=2 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where c.capability='sales.manage' and not c.legacy_admin_only and c.body_md5=md5(p.prosrc)
   and (c.signature,c.guard_kind) in(('public.admin_preview_purchase_confirmation_auto(integer)','read'),
    ('public.admin_save_purchase_confirmation_policy(jsonb,bigint,uuid,uuid,uuid)','write')))
 and exists(select 1 from private.operator_internal_contracts where signature='public.admin_preview_purchase_confirmation_auto(integer)')
 then 1 else 0 end as assert_operator_contracts_registered;

-- 자동 거래확정이 꺼진 상태에서 시작한다(다른 데이터가 있는 DB에서도 같은 결과가 나오게 처음 값을 따로 읽어 둔다).
update private.purchase_confirmation_policy set auto_enabled=false,auto_after_days=null,buyer_extension_days=null,evidence='TEST 이전 근거',revision=1 where singleton;
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_preview_purchase_confirmation_auto(7) as base7 \gset
select public.admin_preview_purchase_confirmation_auto(2) as base2 \gset
select public.admin_preview_purchase_confirmation_auto(30) as base30 \gset
reset role;

-- 구매자 4: 고정 100원 적립, 한도 넉넉함.
select pg_temp.delivered_order(1,4,10,10000,0,pg_temp.credit_policy('fixed',100,1000,100000)) as due_order \gset
select pg_temp.delivered_order(2,4,3,10000,0,pg_temp.credit_policy('fixed',100,1000,100000)) as recent_order \gset
select pg_temp.delivered_order(3,4,10,10000,0,pg_temp.credit_policy('fixed',100,1000,100000)) as held_order \gset
select pg_temp.delivered_order(4,4,10,10000,0,pg_temp.credit_policy('fixed',100,1000,100000)) as claim_order \gset
select pg_temp.delivered_order(5,4,10,10000,0,pg_temp.credit_policy('fixed',100,1000,100000),false) as unpaid_order \gset
select pg_temp.delivered_order(6,4,10,10000,0,null) as no_credit_order \gset
-- 비율 10%: 기준 금액은 배송비를 뺀 20,000원 → 2,000원, 주문당 최대 1,500원에 걸린다.
select pg_temp.delivered_order(7,4,10,23000,3000,pg_temp.credit_policy('rate_bps',1000,1500,100000)) as rate_order \gset
-- 이미 기한을 받은 주문은 그 기한을 그대로 쓴다: 지난 기한(8)은 기간과 상관없이 대상, 남은 기한(9)은 배송완료일 + 기간이 지났어도 대상이 아니다.
select pg_temp.delivered_order(8,4,10,10000,0,pg_temp.credit_policy('fixed',100,1000,100000)) as past_due_order \gset
select pg_temp.delivered_order(9,4,10,10000,0,pg_temp.credit_policy('fixed',100,1000,100000)) as future_due_order \gset
-- 확정 행이 없는 배송완료 주문(거래확정 도입 전 모양)도 저장할 때 기한을 받는다.
select pg_temp.delivered_order(10,4,10,10000,0,pg_temp.credit_policy('fixed',100,1000,100000)) as legacy_order \gset
update private.order_purchase_confirmations set held=true,hold_reason='TEST 보류' where order_id=:'held_order';
insert into public.order_cancellation_requests(order_id,requested_by,reason,reason_type,claim_type,stage)
 values(:'claim_order','c0f1a000-0000-4000-8000-000000000004','TEST 진행 중인 반품','defect','return','requested');
update private.order_purchase_confirmations set auto_due_at=clock_timestamp()-interval '1 day' where order_id=:'past_due_order';
update private.order_purchase_confirmations set auto_due_at=clock_timestamp()+interval '20 days' where order_id=:'future_due_order';
delete from private.order_purchase_confirmations where order_id=:'legacy_order';
-- 구매자 5: 보유 한도 1,000원. 쓸 수 있는 적립금 900원 + 이미 만료된 5,000원(아직 만료 처리 전).
-- 첫 주문은 한도까지 100원만, 둘째 주문은 한도가 차서 0원이다. 만료분을 보유액으로 세면 첫 주문도 0원이 된다.
insert into private.store_credit_lots(id,user_id,root_lot_id,source_kind,issued_amount,available_amount,expires_at) values
 ('c0f1a000-0000-4003-8000-000000000001','c0f1a000-0000-4000-8000-000000000005','c0f1a000-0000-4003-8000-000000000001','admin',900,900,clock_timestamp()+interval '30 days'),
 ('c0f1a000-0000-4003-8000-000000000002','c0f1a000-0000-4000-8000-000000000005','c0f1a000-0000-4003-8000-000000000002','admin',5000,5000,clock_timestamp()-interval '1 day');
select pg_temp.delivered_order(11,5,10,10000,0,pg_temp.credit_policy('fixed',300,1000,1000)) as capped_first \gset
select pg_temp.delivered_order(12,5,9,10000,0,pg_temp.credit_policy('fixed',300,1000,1000)) as capped_second \gset
-- 구매자 6: 한도가 찼지만 갚을 적립금 250원이 있다. 첫 주문은 250원(전부 상계), 둘째 주문은 0원이다.
insert into private.store_credit_lots(id,user_id,root_lot_id,source_kind,issued_amount,available_amount,debt_amount,expires_at) values
 ('c0f1a000-0000-4003-8000-000000000003','c0f1a000-0000-4000-8000-000000000006','c0f1a000-0000-4003-8000-000000000003','admin',1000,1000,250,clock_timestamp()+interval '30 days');
select pg_temp.delivered_order(13,6,10,10000,0,pg_temp.credit_policy('fixed',400,1000,1000)) as debt_first \gset
select pg_temp.delivered_order(14,6,9,10000,0,pg_temp.credit_policy('fixed',400,1000,1000)) as debt_second \gset
-- 구매자 7: 이용 정지 계정. 자동 처리가 건너뛰므로 조회도 세지 않는다.
select pg_temp.delivered_order(15,7,10,10000,0,pg_temp.credit_policy('fixed',100,1000,100000)) as suspended_order \gset
update public.profiles set suspended_at=now(),suspension_reason='TEST 합성 정지' where id='c0f1a000-0000-4000-8000-000000000007';

-- 3. 권한: 로그인하지 않았거나, 운영자가 아니거나, 주문 관리 권한이 없으면 읽지 못한다. 기간은 1~36,500일만 받는다.
set local role authenticated;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
select pg_temp.expect_error('select public.admin_preview_purchase_confirmation_auto(7)','operator_capability_required');
select pg_temp.as_actor(3);
select pg_temp.expect_error('select public.admin_preview_purchase_confirmation_auto(7)','operator_capability_required');
select pg_temp.as_actor(2);
select pg_temp.expect_error('select public.admin_preview_purchase_confirmation_auto(7)','operator_capability_required');
select pg_temp.as_actor(1);
select pg_temp.expect_error('select public.admin_preview_purchase_confirmation_auto(0)','invalid_purchase_confirmation_preview_days');
select pg_temp.expect_error('select public.admin_preview_purchase_confirmation_auto(36501)','invalid_purchase_confirmation_preview_days');
select pg_temp.expect_error('select public.admin_preview_purchase_confirmation_auto(null)','invalid_purchase_confirmation_preview_days');
reset role;

-- 4. 조회는 아무것도 쓰지 않는다: 조회 전후의 행 수·합계·정책이 같다.
select pg_temp.state_fingerprint() as before_preview \gset
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_preview_purchase_confirmation_auto(7) as preview7 \gset
select public.admin_preview_purchase_confirmation_auto(2) as preview2 \gset
select public.admin_preview_purchase_confirmation_auto(30) as preview30 \gset
reset role;
select 1/case when pg_temp.state_fingerprint()=:'before_preview'::jsonb then 1 else 0 end as assert_preview_writes_nothing;

-- 5. 7일로 켜면: 10일 전 배송완료 6건(1·6·7·10·11·12·13·14 가운데 구매자 4의 1·6·7·10, 구매자 5의 11·12, 구매자 6의 13·14)과
--    이미 기한이 지난 8번 = 9건. 3일 전 배송완료(2)·보류(3)·진행 중인 반품(4)·결제 기록 없음(5)·남은 기한(9)·이용 정지(15)는 세지 않는다.
--    적립금: 1번 100 + 6번 0(적립 조건 없음) + 7번 1,500 + 8번 100 + 10번 100 + 11번 100 + 12번 0 + 13번 250 + 14번 0 = 2,150원.
select 1/case when (:'preview7'::jsonb->>'orderCount')::int-(:'base7'::jsonb->>'orderCount')::int=9
 and (:'preview7'::jsonb->>'storeCreditTotal')::bigint-(:'base7'::jsonb->>'storeCreditTotal')::bigint=2150
 and (:'preview7'::jsonb->>'autoAfterDays')::int=7 and (:'preview7'::jsonb->>'perRunLimit')::int=1000
 and (:'preview7'::jsonb->>'asOf')::timestamptz<=clock_timestamp()
 and (select array_agg(key order by key) from jsonb_object_keys(:'preview7'::jsonb) key)=array['asOf','autoAfterDays','orderCount','perRunLimit','remainingDueCount','storeCreditTotal']
 -- 한도(1,000건)를 넘지 않으면 기한이 지난 주문을 모두 본 것이라 다음 날로 넘어가는 주문이 없다.
 and ((:'base7'::jsonb->>'remainingDueCount')::bigint<>0 or (:'preview7'::jsonb->>'remainingDueCount')::bigint=0)
 then 1 else 0 end as assert_seven_day_preview;
-- 2일로 켜면 3일 전 배송완료(2번, 100원)가 더해지고, 30일로 켜면 이미 기한이 지난 8번(100원)만 남는다.
select 1/case when (:'preview2'::jsonb->>'orderCount')::int-(:'base2'::jsonb->>'orderCount')::int=10
 and (:'preview2'::jsonb->>'storeCreditTotal')::bigint-(:'base2'::jsonb->>'storeCreditTotal')::bigint=2250
 and (:'preview30'::jsonb->>'orderCount')::int-(:'base30'::jsonb->>'orderCount')::int=1
 and (:'preview30'::jsonb->>'storeCreditTotal')::bigint-(:'base30'::jsonb->>'storeCreditTotal')::bigint=100
 then 1 else 0 end as assert_period_changes_targets;

-- 6. 정책 저장: 근거·확인 체크 없이 저장한다. 틀린 값은 전처럼 거절한다.
select pg_temp.as_actor(1);
set local role authenticated;
select pg_temp.expect_error($q$select public.admin_save_purchase_confirmation_policy('{"autoEnabled":true,"autoAfterDays":7}',1,gen_random_uuid(),'c0f1a000-0000-4000-8000-000000000001','c0f1a000-0000-4000-9000-000000000001')$q$,'22023');
select pg_temp.expect_error($q$select public.admin_save_purchase_confirmation_policy('{"autoEnabled":true,"autoAfterDays":7,"buyerExtensionDays":null,"memo":"x"}',1,gen_random_uuid(),'c0f1a000-0000-4000-8000-000000000001','c0f1a000-0000-4000-9000-000000000001')$q$,'22023');
select pg_temp.expect_error($q$select public.admin_save_purchase_confirmation_policy('{"autoEnabled":true,"autoAfterDays":null,"buyerExtensionDays":null}',1,gen_random_uuid(),'c0f1a000-0000-4000-8000-000000000001','c0f1a000-0000-4000-9000-000000000001')$q$,'22023');
select pg_temp.expect_error($q$select public.admin_save_purchase_confirmation_policy('{"autoEnabled":true,"autoAfterDays":7,"buyerExtensionDays":null,"evidence":7}',1,gen_random_uuid(),'c0f1a000-0000-4000-8000-000000000001','c0f1a000-0000-4000-9000-000000000001')$q$,'22023');
select pg_temp.expect_error($q$select public.admin_save_purchase_confirmation_policy('{"autoEnabled":true,"autoAfterDays":7,"buyerExtensionDays":null,"acknowledged":"yes"}',1,gen_random_uuid(),'c0f1a000-0000-4000-8000-000000000001','c0f1a000-0000-4000-9000-000000000001')$q$,'22023');
select pg_temp.expect_error(format($q$select public.admin_save_purchase_confirmation_policy(%L,1,gen_random_uuid(),'c0f1a000-0000-4000-8000-000000000001','c0f1a000-0000-4000-9000-000000000001')$q$,
 jsonb_build_object('autoEnabled',true,'autoAfterDays',7,'buyerExtensionDays',null,'evidence',repeat('가',2001))),'22023');
-- 근거·확인 체크 없이 7일로 켠다. 저장돼 있던 근거는 그대로 남는다. 같은 작업 번호로 다시 보내면 같은 결과다.
select public.admin_save_purchase_confirmation_policy('{"autoEnabled":true,"autoAfterDays":7,"buyerExtensionDays":null}',1,'c0f1a000-0000-4002-8000-000000000001','c0f1a000-0000-4000-8000-000000000001','c0f1a000-0000-4000-9000-000000000001') as saved \gset
select 1/case when public.admin_save_purchase_confirmation_policy('{"autoEnabled":true,"autoAfterDays":7,"buyerExtensionDays":null}',1,'c0f1a000-0000-4002-8000-000000000001','c0f1a000-0000-4000-8000-000000000001','c0f1a000-0000-4000-9000-000000000001')=:'saved'::jsonb
 then 1 else 0 end as assert_save_replay;
reset role;
select 1/case when :'saved'::jsonb @> '{"revision":2,"autoEnabled":true,"autoAfterDays":7,"buyerExtensionDays":null,"evidence":"TEST 이전 근거"}'
 and (select auto_enabled and auto_after_days=7 and evidence='TEST 이전 근거' and revision=2 from private.purchase_confirmation_policy where singleton)
 and (select count(*)=1 from public.audit_log where id='c0f1a000-0000-4002-8000-000000000001' and action='admin.purchase_confirmation.policy')
 then 1 else 0 end as assert_save_without_evidence_keeps_stored_evidence;

-- 7. 조회가 말한 값 = 실제 결과. 저장이 채운 기한으로 자동 처리가 확정한 건수와 지급한 적립금이 조회와 같다.
select coalesce(sum(issued_amount),0) as earned_before from private.store_credit_lots where source_kind='order_done' \gset
set local role service_role;
select public.settle_delivered_orders() as settled \gset
select public.settle_delivered_orders() as settled_again \gset
reset role;
select 1/case when :settled=(:'preview7'::jsonb->>'orderCount')::int and :settled_again=0
 and (select coalesce(sum(issued_amount),0) from private.store_credit_lots where source_kind='order_done')-:earned_before=(:'preview7'::jsonb->>'storeCreditTotal')::bigint
 then 1 else 0 end as assert_preview_equals_actual_run;
-- 주문별로도 같다: 대상 9건은 거래확정, 나머지 6건은 배송완료 그대로. 적립금은 조회가 따라간 계산대로다.
select 1/case when (select count(*)=9 from public.orders where status='done' and id=any(array[:'due_order',:'no_credit_order',:'rate_order',:'past_due_order',:'legacy_order',
   :'capped_first',:'capped_second',:'debt_first',:'debt_second']::uuid[]))
 and (select count(*)=6 from public.orders where status='delivered' and id=any(array[:'recent_order',:'held_order',:'claim_order',:'unpaid_order',:'future_due_order',:'suspended_order']::uuid[]))
 and (select jsonb_object_agg(source_order_id,issued_amount) from private.store_credit_lots where source_kind='order_done'
   and source_order_id=any(array[:'due_order',:'no_credit_order',:'rate_order',:'past_due_order',:'legacy_order',:'capped_first',:'capped_second',:'debt_first',:'debt_second']::uuid[]))
  =jsonb_build_object(:'due_order',100,:'rate_order',1500,:'past_due_order',100,:'legacy_order',100,:'capped_first',100,:'debt_first',250)
 then 1 else 0 end as assert_actual_orders_and_credits;
-- 확정이 끝난 뒤 다시 읽으면 남은 대상이 없다(처음 값으로 돌아간다).
select pg_temp.as_actor(1);
set local role authenticated;
select 1/case when (public.admin_preview_purchase_confirmation_auto(7)->>'orderCount')::int=0
 and (public.admin_preview_purchase_confirmation_auto(7)->>'storeCreditTotal')::bigint=0 then 1 else 0 end as assert_nothing_left_after_run;

-- 8. 옛 화면처럼 근거와 확인 체크를 함께 보내는 저장도 그대로 된다(근거는 보낸 값으로 바뀐다). 비어 있는 근거·null은 저장돼 있던 값을 둔다.
select public.admin_save_purchase_confirmation_policy('{"autoEnabled":true,"autoAfterDays":7,"buyerExtensionDays":3,"evidence":" TEST 새 근거 ","acknowledged":true}',2,gen_random_uuid(),'c0f1a000-0000-4000-8000-000000000001','c0f1a000-0000-4000-9000-000000000001') as legacy_saved \gset
select public.admin_save_purchase_confirmation_policy('{"autoEnabled":false,"autoAfterDays":7,"buyerExtensionDays":3,"evidence":null,"acknowledged":false}',3,gen_random_uuid(),'c0f1a000-0000-4000-8000-000000000001','c0f1a000-0000-4000-9000-000000000001') as off_saved \gset
select pg_temp.expect_error($q$select public.admin_save_purchase_confirmation_policy('{"autoEnabled":true,"autoAfterDays":7,"buyerExtensionDays":3}',3,gen_random_uuid(),'c0f1a000-0000-4000-8000-000000000001','c0f1a000-0000-4000-9000-000000000001')$q$,'purchase_confirmation_changed');
reset role;
select 1/case when :'legacy_saved'::jsonb @> '{"revision":3,"buyerExtensionDays":3,"evidence":"TEST 새 근거"}'
 and :'off_saved'::jsonb @> '{"revision":4,"autoEnabled":false,"autoAfterDays":7,"evidence":"TEST 새 근거"}'
 then 1 else 0 end as assert_legacy_values_still_saved;
-- 끄면 자동 처리는 아무것도 확정하지 않는다. 이미 거래확정된 주문은 그대로다.
update private.order_purchase_confirmations set auto_due_at=clock_timestamp()-interval '1 second' where order_id=:'recent_order';
set local role service_role;
select 1/case when public.settle_delivered_orders()=0 then 1 else 0 end as assert_off_stops_automatic;
reset role;
select 1/case when (select status='delivered' from public.orders where id=:'recent_order') and (select status='done' from public.orders where id=:'due_order')
 then 1 else 0 end as assert_off_keeps_confirmed_orders;

-- 9. 쌓인 주문이 자동 처리 한 번의 한도(1,000건)를 넘을 때: 조회는 다음 실행이 집어 들 1,000건만 보고, 나머지는 건수만 돌려준다.
--    지금은 자동 거래확정이 꺼져 있고(8에서 껐다) 기한이 지난 배송완료 주문은 구매자 4의 3건(진행 중인 반품 4번·결제 기록 없음 5번은 후보가 아니고
--    2번은 후보다)과 이용 정지 구매자 7의 1건(15번 — 자리는 차지하지만 확정되지 않는다)이다. 여기에 구매자 8~12의 주문 1,005건을 더한다.
--    순서는 고객 → 기한 → 주문이므로 다음 실행분 1,000건 = 2번 + 15번(건너뜀) + 구매자 8~12의 앞 998건이고, 구매자 12의 마지막 7건이 다음 날로 넘어간다.
--    적립금은 구매자마다 다르게(주문당 80·90·100·110·120원), 구매자 10은 보유 한도 5,000원에 걸리게 해서 어느 주문이 실행분에 드는지에 따라 합계가 달라지게 한다.
--    2번 100 + 구매자 8: 201×80 + 9: 201×90 + 10: 5,000(한도) + 11: 201×110 + 12: 194×120 = 84,660원.
select count(pg_temp.delivered_order(1000+i,8+(i%5),10,10000,0,
  pg_temp.credit_policy('fixed',(80+10*(i%5))::bigint,1000,case when i%5=2 then 5000 else 100000 end))) as bulk_orders
 from generate_series(0,1004) i;
select pg_temp.state_fingerprint() as before_bulk_preview \gset
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_preview_purchase_confirmation_auto(7) as bulk_preview \gset
reset role;
select 1/case when pg_temp.state_fingerprint()=:'before_bulk_preview'::jsonb
 and ((:'base7'::jsonb->>'orderCount')::int<>0 or (:'base7'::jsonb->>'remainingDueCount')::bigint<>0
  or :'bulk_preview'::jsonb @> '{"orderCount":999,"storeCreditTotal":84660,"remainingDueCount":7,"perRunLimit":1000}')
 then 1 else 0 end as assert_bulk_preview_counts_next_run_only;
-- 켜서 저장한 뒤 첫 자동 처리가 확정한 건수와 지급한 적립금이 조회와 같다. 넘어간 주문은 그다음 실행에서 확정되고, 그 값도 다시 읽은 조회와 같다.
select coalesce(sum(issued_amount),0) as bulk_earned_before from private.store_credit_lots where source_kind='order_done' \gset
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_save_purchase_confirmation_policy('{"autoEnabled":true,"autoAfterDays":7,"buyerExtensionDays":3}',4,gen_random_uuid(),'c0f1a000-0000-4000-8000-000000000001','c0f1a000-0000-4000-9000-000000000001') as bulk_saved \gset
reset role;
set local role service_role;
select public.settle_delivered_orders() as bulk_first_run \gset
reset role;
select coalesce(sum(issued_amount),0) as bulk_earned_first from private.store_credit_lots where source_kind='order_done' \gset
select clock_timestamp() as bulk_between_runs \gset
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_preview_purchase_confirmation_auto(7) as bulk_rest_preview \gset
reset role;
set local role service_role;
select public.settle_delivered_orders() as bulk_second_run \gset
select public.settle_delivered_orders() as bulk_third_run \gset
reset role;
select 1/case when :bulk_first_run=(:'bulk_preview'::jsonb->>'orderCount')::int
 and :bulk_earned_first-:bulk_earned_before=(:'bulk_preview'::jsonb->>'storeCreditTotal')::bigint
 and :bulk_second_run=(:'bulk_rest_preview'::jsonb->>'orderCount')::int and :bulk_third_run=0
 and (select coalesce(sum(issued_amount),0) from private.store_credit_lots where source_kind='order_done')-:bulk_earned_first=(:'bulk_rest_preview'::jsonb->>'storeCreditTotal')::bigint
 and (:'bulk_rest_preview'::jsonb->>'remainingDueCount')::bigint=0
 -- 첫 실행이 남긴 주문 수는 조회가 '넘어간다'고 말한 수를 넘지 않는다(값싼 조건만 본 최대치).
 and :bulk_second_run<=(:'bulk_preview'::jsonb->>'remainingDueCount')::bigint
 and ((:'base7'::jsonb->>'orderCount')::int<>0 or (:'base7'::jsonb->>'remainingDueCount')::bigint<>0
  or (:bulk_first_run=999 and :bulk_second_run=7 and :'bulk_rest_preview'::jsonb @> '{"orderCount":7,"storeCreditTotal":840}'
   and (select status='delivered' from public.orders where id=:'suspended_order')
   -- 다음 날로 넘어간 7건은 순서(고객 → 기한 → 주문)의 맨 끝인 구매자 12의 마지막 주문들이다.
   and (select array_agg(id order by id) from public.orders where status='done' and done_at>:'bulk_between_runs')
    =(select array_agg(('c0f1a000-0000-4001-8000-'||lpad((1000+i)::text,12,'0'))::uuid order by i) from generate_series(974,1004,5) i)))
 then 1 else 0 end as assert_bulk_preview_equals_actual_runs;

-- 10. 조회가 따라가는 원본이 바뀌면 여기서 멈춘다 — 그때는 admin_preview_purchase_confirmation_auto도 같은 조건·계산으로 맞춘다.
--    자동 처리의 후보 조건·한 번에 처리하는 건수, 저장할 때 채우는 기한, 거래확정 때의 적립금 계산.
select 1/case when (select prosrc like '%where o.status=''delivered'' and not pc.held and pc.confirmed_at is null and pc.auto_due_at<=clock_timestamp()%'
   and prosrc like '%and private.purchase_confirmation_candidate(o.id)%' and prosrc like '%order by o.user_id,pc.auto_due_at,o.id limit 1000 loop%'
   and prosrc like '%from public.profiles where id=item.user_id and suspended_at is null for no key update skip locked%'
  from pg_proc where oid='public.settle_delivered_orders()'::regprocedure)
 and (select prosrc like '%private.purchase_confirmation_candidate(item.id)%' and prosrc like '%profile.suspended_at is null%'
   and prosrc like '%run_limit constant integer := 1000;%' and prosrc like '%order by due.user_id, due.due_at, due.id%'
  from pg_proc where oid='public.admin_preview_purchase_confirmation_auto(integer)'::regprocedure)
 then 1 else 0 end as assert_same_target_rule_as_worker;
select 1/case when (select (length(prosrc)-length(replace(prosrc,'o.delivered_at+make_interval(days=>p.auto_after_days)','')))/length('o.delivered_at+make_interval(days=>p.auto_after_days)')=2
   and prosrc like '%and c.auto_due_at is null and c.confirmed_at is null%' and prosrc like '%where o.status=''delivered'' and o.delivered_at is not null%'
  from pg_proc where oid='private.backfill_purchase_confirmation_due_dates()'::regprocedure)
 then 1 else 0 end as assert_same_due_date_rule_as_backfill;
select 1/case when (select prosrc like '%elsif new.status=''done'' and new.store_credit_policy_snapshot is not null then%'
   and prosrc like '%if exists(select 1 from private.store_credit_lots where source_order_id=new.id and source_kind=''order_done'') then return null; end if;%'
   and prosrc like '%basis:=greatest(0,new.total-new.shipping_fee-private.order_partial_canceled_goods_amount(new.id));%'
   and prosrc like '%earned:=case when policy->>''earnKind''=''rate_bps'' then floor(basis::numeric*(policy->>''earnValue'')::numeric/10000)::bigint else (policy->>''earnValue'')::bigint end;%'
   and prosrc like '%earned:=least(earned,(policy->>''earnMaxPerOrder'')::bigint);%'
   and prosrc like '%earned:=least(earned,greatest(0,(policy->>''maxBalance'')::bigint-(balance->>''available'')::bigint-(balance->>''reserved'')::bigint)+(balance->>''debt'')::bigint);%'
  from pg_proc where oid='private.store_credit_order_transition()'::regprocedure)
 then 1 else 0 end as assert_same_earning_rule_as_done_trigger;
rollback;
